# gpt-image-cli 设计文档

**日期**: 2026-04-23
**状态**: 已评审,待实现
**作者**: andrew

## 背景与目标

构建一个命令行工具 `gpt-image-cli`,通过 OpenAI 的 `gpt-image-2` 模型完成文本到图像生成与图像编辑,并配套一份 `skills/gpt-image/SKILL.md`,让 Claude Code / Agent 能直接驱动 CLI 完成视觉任务。

架构与契约参考 `ThinkingAIAgenticEngine/ae-cli` 及本地 `te-cli`,以保持 Agent 工具链的一致风格(`{ok,data}` envelope、`--format/--jq/--dry-run/--yes` 全局 flag、`skills/<name>/SKILL.md` 清单)。

**非目标**:
- 视觉理解(image analysis / vision)。本 CLI 只负责生成与编辑。
- 其他 model-id。**仅支持 `gpt-image-2`**,在 SDK 调用处硬编码为 `model: "gpt-image-2"`,**不暴露 `--model` flag**。
- 会话式多轮精修(Responses API 路径)。多轮靠 `--image <上一次输出>` 重喂。

## 范围

**支持的操作**:
1. **Generate** — 基于 prompt 文生图。
2. **Edit** — 基于一张或多张输入图 + prompt 的图生图,可选 inpainting mask。
3. **Config** — `~/.gpt-image-cli/config.json` 的初始化与读写。

## 架构

### 运行时与依赖

- **Node.js ≥ 18**(原生 `fetch`,ESM)。
- **TypeScript**,`tsup` 打包到 `dist/`,输出 ESM。
- 核心依赖:
  - `commander` — CLI 解析。
  - `openai` — 官方 SDK,原生支持 `baseURL` 覆盖,负责 multipart 上传。
  - `mime` — 输入图 MIME 推断(edit 必需)。
  - `cli-table3` — `--format table` 渲染。
- 测试依赖:`vitest`, `msw`。

### 目录结构

```
gpt-image-cli/
├── src/
│   ├── index.ts                  # 入口: 装配 Commander program, 加载命令
│   ├── framework/
│   │   ├── types.ts              # Command / OutputEnvelope / Config 类型
│   │   ├── output.ts             # JSON envelope 格式化 + --format table 渲染 + --jq 过滤
│   │   └── errors.ts             # 统一错误 → envelope + 退出码
│   ├── core/
│   │   ├── config.ts             # 配置加载 (flag > env > file > default)
│   │   ├── client.ts             # OpenAI 客户端工厂 (注入 api_key + baseURL)
│   │   └── image-input.ts        # --image/--mask 解析: 本地路径 or URL → Buffer+mime
│   └── commands/
│       ├── generate.ts           # generate 子命令
│       ├── edit.ts               # edit 子命令
│       └── config.ts             # config init/set/get/show/path
├── bin/
│   └── gpt-image-cli.js          # 两行 shebang + import('../dist/index.js')
├── skills/
│   └── gpt-image/
│       └── SKILL.md              # 单文件 SKILL (中文)
├── docs/
│   └── superpowers/specs/
│       └── 2026-04-23-gpt-image-cli-design.md
├── tests/
│   ├── unit/                     # core/*, framework/* 单元测试
│   └── integration/              # msw 拦截 OpenAI 端点的集成测试
├── scripts/
│   └── smoke.sh                  # 真实 API 手工冒烟
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

### 模块边界

- `core/*` 不依赖 `commands/*`,反之 OK。
- `framework/*` 不依赖 `core/*`,也不依赖 `commands/*`。
- OpenAI SDK 只在 `core/client.ts` 和 `commands/*` 中出现,其他模块不感知。

### 数据流

```
CLI args → Commander parse → Config.resolve() → OpenAI client
        → (generate|edit) call → base64 image buffer[]
        → write to disk (auto-name or --out)
        → JSON envelope to stdout (+ optional base64 on --stdout-base64)
```

## 命令表面

### 全局 flag

| Flag | 说明 |
|---|---|
| `--endpoint <url>` | 覆盖 base URL |
| `--api-key <key>` | 覆盖 API key(慎用,优先用 env) |
| `--format <json\|table>` | 输出格式,默认 `json` |
| `--jq <expr>` | 对 envelope 做 jq 过滤 |
| `--dry-run` | 只打印请求体,不调用 API |
| `--yes` | 跳过破坏性确认(`config set` 覆盖已有值) |
| `--verbose` | 打印 SDK 请求/响应摘要到 stderr |
| `-h, --help` | 帮助 |
| `--version` | 版本 |

### `generate` — 文生图

```
gpt-image-cli generate -p <prompt> [options]
```

| Flag | 值 | 默认 |
|---|---|---|
| `-p, --prompt <text>` | string,`-` 从 stdin | **必填** |
| `-n, --count <int>` | 1–10 | 1 |
| `-s, --size <wxh>` | `1024x1024` / `1024x1536` / `1536x1024` / `auto` | `auto` |
| `-q, --quality <level>` | `low` / `medium` / `high` / `auto` | `auto` |
| `-b, --background <mode>` | `transparent` / `opaque` / `auto` | `auto` |
| `-f, --output-format <fmt>` | `png` / `jpeg` / `webp` | `png` |
| `--compression <0-100>` | int(仅 jpeg/webp) | 未设置时不传 |
| `--moderation <level>` | `auto` / `low` | `auto` |
| `--out <path>` | 文件或目录 | `./gpt-image-<ts>-<idx>.<ext>`(cwd) |
| `--stdout-base64` | bool | false |

**`--out` 语义**:
- 指向目录 → 使用自动命名,落到该目录。
- 指向文件路径:`n=1` 时直接用该路径;`n>1` 时把后缀换成 `<stem>-<idx>.<ext>`。
- 未指定 → cwd + 自动命名。

### `edit` — 图生图 / inpainting

```
gpt-image-cli edit -p <prompt> --image <path|url> [--image <...>] [--mask <path|url>] [options]
```

额外 flag:

| Flag | 值 | 默认 |
|---|---|---|
| `--image <path\|url>` | 多次指定,至少一张 | **必填** |
| `--mask <path\|url>` | 单张 | - |
| `--input-fidelity <level>` | `low` / `high` | `low` |

其余 flag 与 `generate` 相同(prompt/count/size/quality/background/output-format/compression/moderation/out/stdout-base64)。

### `config` — 配置管理

```
gpt-image-cli config init                 # 交互式向导
gpt-image-cli config set <key> <value>    # key ∈ {api_key, endpoint}
gpt-image-cli config get <key>
gpt-image-cli config show                 # 打印当前生效配置 (api_key 脱敏)
gpt-image-cli config path                 # 打印配置文件路径
```

## 配置与鉴权

### 解析优先级(高 → 低)

```
1. CLI flag     --api-key / --endpoint
2. Env var      OPENAI_API_KEY / OPENAI_BASE_URL
3. Config file  ~/.gpt-image-cli/config.json  { api_key?, endpoint? }
4. Default      endpoint = https://api.openai.com/v1   (api_key 无默认)
```

缺 `api_key` → `CONFIG_MISSING` 错误,提示 "Set OPENAI_API_KEY or run `gpt-image-cli config init`"。

### 配置文件

```json
{
  "api_key": "sk-...",
  "endpoint": "https://api.openai.com/v1"
}
```

首次写入:父目录 `mkdir -p` + `chmod 700`,文件 `chmod 600`。字段未设置时省略 key(不写空字符串)。

### `config init` 交互

最小 TTY 交互,不引入 `inquirer`,用 Node 原生 `readline` + `process.stdin.setRawMode`:

```
? OpenAI API key (sk-...): <masked input>
? Endpoint (leave empty for default https://api.openai.com/v1): 
✓ Wrote ~/.gpt-image-cli/config.json
```

非 TTY 环境(CI / pipe)下拒绝 `config init`,提示改用 `config set`。

### 脱敏

`config show` 与 `--verbose` 日志中,api_key 仅显示 `sk-***` + 末 4 字符(例 `sk-***AbCd`)。
`--verbose` 会在 stderr 打印一行 `[config] source: { api_key: env, endpoint: file }`,不暴露具体值。

## 输出协议

### envelope 形状

成功(单张):
```json
{
  "ok": true,
  "data": {
    "model": "gpt-image-2",
    "operation": "generate",
    "paths": ["./gpt-image-20260423-153012.png"],
    "size": "1024x1024",
    "quality": "auto",
    "output_format": "png",
    "count": 1,
    "usage": { "input_tokens": 12, "output_tokens": 1568, "total_tokens": 1580 }
  }
}
```

成功(多张):`paths` 为长度 `n` 的数组,其余字段不变。

`config` 子命令:
```json
{ "ok": true, "data": { "path": "~/.gpt-image-cli/config.json", "fields": ["endpoint"] } }
```

失败:
```json
{
  "ok": false,
  "error": {
    "code": "...",
    "message": "...",
    "details": { ... }
  }
}
```

### `--format table`

渲染 `paths / size / quality / count / usage` 的两列表格(`cli-table3`)。错误时 fallback 回 JSON。

### `--jq <expr>`

在 envelope 上 apply。MVP 复刻 `te-cli` 的 `framework/output.ts` 实现方式,避免重复决策。

### `--stdout-base64`

- 图片 base64 每张一行写到 **stdout**。
- envelope JSON 改写到 **stderr**。
- 保证 `gpt-image-cli generate ... --stdout-base64 | base64 -d > out.png` 可用。

### `--dry-run`

不调 API,envelope `data` 改为 `{ operation, request: { ...params } }`,不写任何文件。退出码 `0`。

### 自动命名

- 单张:`gpt-image-<YYYYMMDD-HHmmss>.<ext>`
- 多张:`gpt-image-<YYYYMMDD-HHmmss>-<idx>.<ext>`(`idx` 从 0 起)
- `<ext>` 取自 `--output-format`
- 时间戳使用本地时区
- 同秒内多次调用追加 2 位随机 hash 防冲突:`gpt-image-<ts>-<hash>.<ext>`

## 错误处理与退出码

### 分类

| `error.code` | 触发条件 | 退出码 |
|---|---|---|
| `CONFIG_MISSING` | 未提供 `api_key` | 2 |
| `INVALID_INPUT` | flag 值非法(size/quality/count 越界)、prompt 为空、`--image` 不存在、MIME 不支持、`model-id` 非 `gpt-image-2` | 2 |
| `IO_ERROR` | 无法读输入图、无法写输出目录、磁盘满 | 3 |
| `OPENAI_API_ERROR` | OpenAI SDK `APIError`(4xx/5xx) | 4 |
| `NETWORK_ERROR` | 请求超时、DNS、连接失败 | 5 |
| `INTERNAL` | 未预期异常 | 10 |

退出码 `0` 仅在 `ok: true` 时给出。`--dry-run` 成功退出 `0`。

### OpenAI 错误透传

`error.details` 原样带 SDK 的 `status / code / type / message`:

```json
{
  "ok": false,
  "error": {
    "code": "OPENAI_API_ERROR",
    "message": "Billing quota exceeded",
    "details": { "status": 429, "type": "insufficient_quota", "code": "quota_exceeded" }
  }
}
```

### 校验时机

在调 API 之前尽量早失败:

- Commander 完成解析后立即校验:`count ∈ [1,10]`、`size/quality/background/output-format/moderation/input-fidelity` 枚举、`compression ∈ [0,100]`、`--compression` 仅 jpeg/webp 有效、`--background transparent` 要求 `png/webp`。
- `--image` / `--mask` 本地路径:`fs.access` 检查存在且可读;URL:校验 `http(s)://` 前缀(实际下载在 `core/image-input.ts`)。
- prompt 空串 → `INVALID_INPUT`;`--prompt -` 且 stdin 为空 → 同。

### 重试

依赖 OpenAI SDK 自带的指数退避(默认 2 次)。MVP **不自己包重试**。

### stderr 噪声

默认不打印堆栈;`--verbose` 下打印 OpenAI SDK debug + 本地堆栈到 stderr。stdout 始终干净:只有 envelope,或 `--stdout-base64` 下的 base64。

## SKILL 设计

### 文件位置

`skills/gpt-image/SKILL.md`,**单文件**,中文撰写。

### Frontmatter

```yaml
---
name: gpt-image
version: 1.0.0
description: "用 gpt-image-2 通过 gpt-image-cli 进行文生图和图像编辑。当用户需要生成图片、修图、加元素、抠背景、替换场景等视觉任务时使用。"
metadata:
  requires:
    bins: ["gpt-image-cli"]
  cliHelp: "gpt-image-cli --help"
---
```

### 内容骨架

```
# gpt-image

一句话: 本 SKILL 驱动 gpt-image-cli,用 OpenAI gpt-image-2 模型生成或编辑图片。

## 前置
1. 确认 `gpt-image-cli` 可执行。不可执行则提示用户 `npm i -g gpt-image-cli`
   (若已发布)或在仓库中 `npm link`(本地开发)。
2. 配置 API key: 优先 env `OPENAI_API_KEY`;若缺失,引导 `gpt-image-cli config init`。
3. 自建/代理 endpoint: `gpt-image-cli config set endpoint https://...` 或
   `--endpoint <url>` 单次覆盖。

## 核心命令
### 文生图 (generate)
- 模板: `gpt-image-cli generate -p "<prompt>" [-s 1024x1024] [-q high] [--out <path>]`
- 批量: `-n 4 --out ./outdir/`
- stdout 拿 base64: `--stdout-base64` (envelope 走 stderr)

### 图生图 (edit)
- 单图: `gpt-image-cli edit --image base.png -p "<指令>" --out new.png`
- 多图合成: 多次 `--image`
- 抠/补: 加 `--mask mask.png`
- 保真: `--input-fidelity high`

### 读结果
stdout 默认是 JSON envelope: `{ ok, data: { paths, size, usage, ... } }`。
配 `--jq '.data.paths[0]'` 直接拿到第一张路径。

## 选参建议
| 意图 | 推荐参数 |
|---|---|
| 快速草图/预览 | `-q low` |
| 最终产出 | `-q high` |
| 透明背景(图标/贴纸) | `-b transparent -f png` |
| 人像/品牌细节 | `edit --input-fidelity high` |
| 无 prompt 想做变体 | `edit --image src.png -p "variation of this image"` |

## 常见错误
- `CONFIG_MISSING` → 引导 `config init` 或设置 env。
- `OPENAI_API_ERROR` `status=429` → 配额/限流,建议降 `-q` 或减 `-n`。
- `INVALID_INPUT` `size` → 只允许 1024x1024/1024x1536/1536x1024/auto。
- `IO_ERROR` → 检查 `--out` 目录是否存在可写。

## 安全
- 一次调用可能数秒到数十秒,batch 更慢。
- cwd 不合适时务必传 `--out`。
- 不要把 API key 写进 shell history:用 env 或配置文件。

## 不要做
- 不要用本 SKILL 分析/识别现有图片(vision 任务,本 CLI 不覆盖)。
- 不要尝试除 `gpt-image-2` 以外的 model-id(CLI 会拒绝)。
```

规模:120–150 行。不拆子文件。

## 测试与开发流程

### 测试策略

| 层级 | 范围 | 工具 |
|---|---|---|
| 单元 | `core/config.ts` 优先级解析、`core/image-input.ts` path/URL 分流、`framework/output.ts` envelope 与 `--jq` 过滤、flag 校验器 | `vitest` |
| 集成(mocked) | `generate` / `edit` 端到端 — `msw` 拦截 OpenAI 端点,断言请求体和 envelope | `vitest` + `msw` |
| 手工冒烟 | 真实 API key 打一次 `generate` 和 `edit` | `scripts/smoke.sh` |

**不做**:快照图片内容断言、依赖真实 OpenAI 响应的 CI 测试。

### package.json scripts

```
"dev":   "tsx src/index.ts",
"build": "tsup src/index.ts --format esm --outDir dist --clean",
"test":  "vitest run",
"lint":  "tsc --noEmit",
"prepublishOnly": "npm run lint && npm run test && npm run build"
```

### 发布就绪物(保留不实发)

- `package.json`:
  - `"bin": { "gpt-image-cli": "./bin/gpt-image-cli.js" }`
  - `"files": ["bin/","dist/","skills/","README.md"]`
  - `"engines": { "node": ">=18.0.0" }`
- `bin/gpt-image-cli.js`:shebang + `import('../dist/index.js')`。
- `README.md`:安装、`config init`、`generate` / `edit` 示例、SKILL 装法。

### CI

MVP 不加。后续加时仅跑 `lint + test`,不跑真实 API。

### 版本起点

`1.0.0`。

## 已排除(YAGNI)

- `--seed`(gpt-image-2 支持情况不明,先不暴露)
- Variation 独立子命令(与 edit 合流,无 prompt 的 edit 即 variation)
- Responses API 路径(多轮精修)
- 多 profile 配置(单账号够用)
- OpenAI File ID 形式的 `--image`(edit 端点不直接吃,需多一步 Files API)
- 自实现重试(依赖 SDK)
- 真实 API 的 CI 冒烟

## 待实现清单(高层,详细分步由 writing-plans 产出)

1. 仓库骨架:`package.json`、`tsconfig.json`、`tsup.config.ts`、`bin/`、目录占位。
2. `framework/`:类型、envelope 输出、错误映射。
3. `core/config.ts` + `config` 子命令 + `config init` 交互。
4. `core/client.ts`:OpenAI 客户端工厂。
5. `core/image-input.ts`:本地路径 / URL 解析。
6. `generate` 子命令 + 文件写入 + 自动命名。
7. `edit` 子命令,复用 generate 的输出路径逻辑。
8. `skills/gpt-image/SKILL.md`。
9. 单元测试 + `msw` 集成测试。
10. `README.md` + `scripts/smoke.sh`。
