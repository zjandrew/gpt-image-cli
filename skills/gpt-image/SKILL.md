---
name: gpt-image
version: 1.0.0
description: "用 gpt-image-2 通过 gpt-image-cli 进行文生图和图像编辑。当用户需要生成图片、修图、加元素、抠背景、替换场景等视觉任务时使用。"
metadata:
  requires:
    bins: ["gpt-image-cli"]
  cliHelp: "gpt-image-cli --help"
---

# gpt-image

一句话:本 SKILL 驱动 `gpt-image-cli`,用 OpenAI `gpt-image-2` 模型生成或编辑图片。

## 前置

1. 确认 `gpt-image-cli` 可执行(`which gpt-image-cli` 或 `gpt-image-cli --version`)。
   不可执行则提示用户 `npm install -g @zhoujinandrew/gpt-image-cli` 或在仓库中 `npm link`。
2. 配置 API key:优先 env `OPENAI_API_KEY`;若缺失,引导
   `gpt-image-cli config init`(交互式,需 TTY)或 `config set api_key <value>`。
3. 自建/代理 endpoint:`gpt-image-cli config set endpoint https://<...>/v1`
   或 `--endpoint <url>` 单次覆盖。

## 核心命令

### 文生图 (generate)

- 基础:`gpt-image-cli generate -p "<prompt>" --out ./out.png`
- 控制画幅/质量:`-s 1024x1024 -q high`
- 批量 + 输出目录:`-n 4 --out ./outdir/`
- 管道拿 base64:`... --stdout-base64 | base64 -d > out.png`
  (envelope 会走 stderr)

### 图生图 (edit)

- 单图修改:`gpt-image-cli edit --image base.png -p "<指令>" --out new.png`
- 多图合成:多次 `--image`,例 `--image a.png --image b.png -p "把 a 里的物体放到 b 的场景中"`
- 局部修改:再加 `--mask mask.png`(mask 白色区域是要被改的)
- 保真:`--input-fidelity high`,适合人像、品牌、细节要求高的场景

### 读结果

stdout 默认是 JSON envelope:`{ ok, data: { paths, size, usage, ... } }`。
配 `--jq '.data.paths[0]'` 将结果过滤到路径字段 — 输出仍是 envelope
形式:`{"ok": true, "data": "/abs/path.png"}`。Shell 里再 `| jq -r .data`
可拿裸字符串。

## 选参建议

| 意图 | 推荐参数 |
|---|---|
| 快速草图/预览 | `-q low` |
| 最终产出 | `-q high` |
| 透明背景(图标/贴纸) | `-b transparent -f png` |
| 人像/品牌细节 | `edit --input-fidelity high` |
| 无 prompt 想做变体 | `edit --image src.png -p "a variation of this image"` |
| JPEG 压缩控制 | `-f jpeg --compression 80` |

## 常见错误处置

- `CONFIG_MISSING` → 引导用户 `config init` 或 `export OPENAI_API_KEY=...`
- `OPENAI_API_ERROR` `status=429` → 配额/限流,建议降 `-q` 或减 `-n`,或稍等后重试
- `OPENAI_API_ERROR` `status=400` → 读 `error.details.message`,通常是 prompt 或 size 不符合策略
- `INVALID_INPUT size` → 只允许 `1024x1024` / `1024x1536` / `1536x1024` / `auto`
- `INVALID_INPUT` 透明背景 → `--background transparent` 要求 `--output-format png` 或 `webp`
- `IO_ERROR` → 检查 `--out` 目录是否存在且可写
- `NETWORK_ERROR` → 网络或 endpoint 配置异常,核对 `gpt-image-cli config show`

## 安全与预期

- 单次调用耗时数秒至数十秒,batch 更慢,避免没必要的 `-n` 放大。
- cwd 不合适时务必传 `--out`,不要在任意目录默认落盘。
- 不要把 API key 写进 shell history:用 `OPENAI_API_KEY` env 或 `config init`。
- 脚本场景首选 `--format json` + `--jq`,稳定可解析。

## 不要做

- 不要用本 SKILL 分析或识别现有图片(vision 任务,本 CLI 不覆盖)。
- 不要尝试调用除 `gpt-image-2` 以外的 model-id(CLI 写死 `gpt-image-2`,无 `--model` flag)。
- 不要自己拼 `curl` 调 OpenAI Images 端点 — 走 CLI,保证 envelope/错误路径统一。
