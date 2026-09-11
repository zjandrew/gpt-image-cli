---
name: gpt-image
version: 2.0.0
description: "当用户需要生成图片、修图、加元素、抠背景、替换场景,或多轮迭代优化图片(探索 → 选片 → 精修 → 交付)时使用。"
metadata:
  requires:
    bins: ["gpt-image-cli"]
  cliHelp: "gpt-image-cli --help"
---

# gpt-image

一句话:本 SKILL 驱动 `gpt-image-cli`,用 OpenAI gpt-image-2.5 系列
(`gpt-image-2.5-flare` 默认,`gpt-image-2.5-sunburst` 精修)生成或编辑图片。

**核心原则**:统一走 `gpt-image-cli` 入口(不手拼 curl);默认 flare,按下文规则
切 sunburst 并在汇报里说明原因;每次生图后必 `Read` 本轮刚写的 PNG 再汇报;
探索阶段靠完整自洽的 prompt,精修阶段靠 `edit` 链式增量修改。

## 前置

1. 确认 `gpt-image-cli` 可执行(`which gpt-image-cli` 或 `gpt-image-cli --version`,
   需 ≥ 1.3.0 才有 `--model`)。不可执行则提示用户
   `npm install -g @zhoujinandrew/gpt-image-cli` 或在仓库中 `npm link`。
2. 配置 API key:优先 env `OPENAI_API_KEY`;若缺失,引导
   `gpt-image-cli config init`(交互式,需 TTY)或 `config set api_key <value>`。
3. 自建/代理 endpoint:`gpt-image-cli config set endpoint https://<...>/v1`
   或 `--endpoint <url>` 单次覆盖。Azure 或多端点场景见下节。

## 多端点配置(OpenAI / Azure)

支持同时保存多个 endpoint(公有 OpenAI、自建代理、Azure deployment)并切换。

```bash
gpt-image-cli config list                     # 查看所有 profile,带 active 标记
gpt-image-cli config use <name>               # 切换 active profile
gpt-image-cli config add <name> --type azure  # 向导式新增 Azure profile
gpt-image-cli config add <name> --type openai # 向导式新增 OpenAI profile
gpt-image-cli --profile <name> generate ...   # 单次覆盖,不改 active
gpt-image-cli config show [<name>]            # 查看具体 profile(api_key 已脱敏)
```

Azure profile 字段:`endpoint`(resource 根 URL,不含 `/openai/deployments/...`
路径)、`deployment`、`api_version`、`api_key`、`auth_style`(`api-key`
默认,匹配 Microsoft 文档;或 `bearer` 对应 `Authorization: Bearer <key>`
风格的网关)。

Azure profile 约定与限制:
- **deployment 名必须与模型 ID 相同**(`gpt-image-2.5-flare` / `gpt-image-2.5-sunburst`),
  这样 `--model` 才能在 Azure 上直接切换模型。
- `output_format=webp` 不受支持,改用 `png` 或 `jpeg`(CLI 会在请求前直接报错)。
- size / 长宽比规则与 OpenAI 一致(见下文)。

环境变量:`OPENAI_API_KEY` / `OPENAI_BASE_URL` 仍可作为"零 profile"
临时凭据;`GPT_IMAGE_PROFILE` 可不改 active 临时切换到另一个 profile;
优先级 `--profile flag > GPT_IMAGE_PROFILE env > 文件 active`。

## 模型选择

| 模型 | 定位 | 用在 |
|---|---|---|
| `gpt-image-2.5-flare` | 快、画质高、默认 | 一次性出图、探索候选、批量 |
| `gpt-image-2.5-sunburst` | 旗舰、编辑精度与多轮一致性最强 | 精修阶段、最终稿 |

两者 token 单价相同,sunburst 明显更慢。不传 `--model` 即 flare;
要用 sunburst 在任何命令前加 `--model gpt-image-2.5-sunburst`
(OpenAI profile 改 model 字段,Azure profile 改 deployment 名)。

**切换到 sunburst 的规则**(命中任一即切,自动切换不问用户,但汇报里带一句原因):
1. `edit` 且用户要求"其他部分不动,只改 X"这类严格保持约束。
2. 已进入精修阶段(用户从探索候选里选定了基线版本)。
3. 用户说这是最终稿 / KV / hero shot / 客户交付。
4. 用户点名 sunburst。

其余情况一律 flare。

## 核心命令

### 文生图 (generate)

- 基础:`gpt-image-cli generate -p "<prompt>" --out ./out.png`
- 控制画幅/质量:`-s 1920x1088 -q high`
- 批量 + 输出目录:`-n 4 --out ./outdir/`
- 指定模型:`gpt-image-cli --model gpt-image-2.5-sunburst generate ...`
- 管道拿 base64:`... --stdout-base64 | base64 -d > out.png`
  (envelope 会走 stderr)

### 图生图 (edit)

- 单图修改:`gpt-image-cli edit --image base.png -p "<指令>" --out new.png`
- 多图合成:多次 `--image`,例 `--image a.png --image b.png -p "把 a 里的物体放到 b 的场景中"`
- 局部修改:再加 `--mask mask.png`(mask 白色区域是要被改的)
- 不要传 `--input-fidelity`:gpt-image-2.5 系列不支持该参数,传了会 400;
  2.5 的 `edit` 本身就是高保真,靠 prompt 说明"保持什么"即可

### 读结果

stdout 默认是 JSON envelope:`{ ok, data: { model, paths, size, usage, ... } }`,
`data.model` 是本次实际使用的模型。配 `--jq '.data.paths[0]'` 将结果过滤到路径
字段 — 输出仍是 envelope 形式:`{"ok": true, "data": "/abs/path.png"}`。
Shell 里再 `| jq -r .data` 可拿裸字符串。

## 探索 → 选片 → 精修 → 交付

**触发条件**:用户说"先给我看一版"、"出几张我挑挑"、"多轮优化"、"生成 → 反馈 → 修改",
或在第一版出来后继续描述修改意见。**用户一句话只要一张图时不进流水线**,直接 flare
单张出图。

**产物目录**:`./refine/<topic>/`,`<topic>` 取自用户对此次任务的简短命名(没给就按
任务语义自造 kebab-case,如 `poster-hero`);若目录已有 `v1.png`,改用
`./refine/<topic>-<YYYYMMDD-HHMM>/`,避免覆盖历史。

**1. 探索(flare,`generate`)**
- 默认 `-n 3 -q medium`(`-n` 上限 4,别一次出十几张让用户选不过来),
  `-s` 选定后全程固定
- 产物 `v1a.png / v1b.png / v1c.png`;逐张 `Read`,每张一句关键视觉要素汇报
- 用户要求整体换方向 → 重写 prompt 再探索一轮,仍是 flare

**2. 选片**
- 用户点名一张 → `cp refine/<topic>/v1b.png refine/<topic>/v1.png`,作为精修基线
- 从这一步起切 sunburst,汇报时说明"进入精修阶段,后续用 sunburst"

**3. 精修(sunburst,`edit`)**
- 每轮 `gpt-image-cli --model gpt-image-2.5-sunburst edit --image v(N-1).png -p "<两段模板>" --out vN.png`
- 链式累积:以上一版为基图,只描述本轮增量(模板见下节)
- 生成后 `Read` 本轮 vN,汇报"改了 X / 保留了 Y"
- 发现漂移(不该动的元素变了)→ 回退到更早的干净版本作基图,重做本轮

**4. 交付**
- 用户定稿 → `cp refine/<topic>/vN.png refine/<topic>/final.png`
- 需要极限细节时,用同一 prompt 加 `-q xhigh` 重出最后一版;`max` 仅在用户明确
  要求时用
- `final.png` 可直接作为视频模型(如 seedance)的首帧或参考图

## 多轮优化的 prompt 与纪律

流程见上节,这里是每轮怎么写 prompt。

**探索阶段(generate)— 四段自洽模板**:每次都是从零构图,prompt 必须完整自包含。

```
[主体与构图]:<主角是什么、怎么摆、视角方向>
[配色与风格]:<主色调、辅色、质感、艺术风格>
[关键细节]:<文字/LOGO/小物件等绝不能丢的元素>
[本轮修改]:<用户这次提的反馈,叠加不替换>
```

展开成一段自然语言 prompt(不带 `[...]` 标签),200 字内。

**精修阶段(edit)— 两段模板**:模型看得见基图,不要重述全部要素,重述反而诱导它重画。

```
[保持不变]:<列出本轮绝不能动的元素,如"人物姿态、Logo、包装文字、灯光">
[本轮只改]:<一句增量指令,如"把背景换成黑色镜面台面">
```

展开成两三句自然语言即可。

### 必须做

- 每轮生成后 `Read` **本轮刚写的** PNG(不是旧图、不是凭记忆)
- 探索 prompt 完整自洽;精修 prompt 明确"保持什么 / 只改什么"
- `-s` 跨轮稳定;进入精修后模型固定 sunburst
- 每轮明确告诉用户"改了什么 / 保留了什么",切换模型时说明原因

### 必须不做

- 探索阶段不要写 "like before but brighter" / "保持原样只改 X",generate 没有上下文
- 精修阶段不要把整段探索 prompt 原样塞给 `edit`,那等于让它重画
- 不要跨轮改 `-s`,会造成构图大跳
- 不要传 `--input-fidelity`
- 不要生成完不 `Read` 就给用户总结

### Red Flags — 出现这些信号立即停下

- 我正要凭记忆写下一版 prompt → **停**,先 `Read` 刚生成的图
- 我在探索阶段正要写 "keep the previous but..." → **停**,按四段模板重写完整 prompt
- 我在精修阶段正要重述整张图 → **停**,改成"保持 / 只改"两段
- 我正要把 `-s` 换一个值 → **停**,先问用户是否要换构图
- 用户已选定基线,我还在用 flare → **停**,切 sunburst 并说明

### 局限与兜底

即便是 sunburst,链式多轮后仍可能有轻微漂移。发现后不要硬着头皮继续叠加,
回退到最近一个干净版本作基图重做本轮。多个元素要求像素级不动时,把它们逐一
写进 `[保持不变]`,必要时配 `--mask` 只开放要改的区域。

## 尺寸与长宽比 (`-s`)

`-s` 接受 `auto` 或 `<width>x<height>`,默认 `auto`。**不要死记某几个"允许尺寸"**,
自由组合即可,只要满足下面 4 条约束:

| 约束 | 取值 |
|---|---|
| 每边 | 256–3840 px(支持 4K UHD) |
| 双边必须 | 16 的倍数 |
| 总像素 | 655,360 – 8,294,400(≈ 0.66MP – 8.3MP) |
| 长短边比例 | 在 1:3 – 3:1 之间 |

**任意长宽比的推导公式**:想要比例 `R:S`、长边 L,则 `W = L, H = L * S / R`,
最后各自向下对齐到 16 的倍数。示例:16:9 @ L=1920 → H = 1920 * 9/16 = 1080 → 对齐 16 → **1088**。

### 常用尺寸速查

| 比例 | 低分辨率 | 中 | 高 / 4K |
|---|---|---|---|
| 1:1 正方形 | 1024x1024 | 2048x2048 | 2880x2880 |
| 3:2 横版(native) | 1536x1024 | 2304x1536 | 3072x2048 |
| 2:3 竖版(native) | 1024x1536 | 1536x2304 | 2048x3072 |
| 16:9 幻灯片/视频 | 1600x896 | 1920x1088 | 2560x1440 / 3840x2160 |
| 9:16 短视频/Story | 896x1600 | 1088x1920 | 1440x2560 / 2160x3840 |
| 4:3 印刷 | 1280x960 | 2048x1536 | 2880x2160 |
| 21:9 超宽海报 | 1680x720 | 2240x960 | 3360x1440 |

**⚠️ Prompt 与画布一致性**:在 prompt 里声明的长宽比
(如 "16:9 for slide"、"portrait poster") 必须跟 `-s` 对齐,否则模型按一种比例
构图、画布是另一种,成品贴到最终载体上会感觉被拉伸。不确定时:
1. 不要在 prompt 里硬写比例数字,改用语义词("landscape slide"/"vertical poster")
2. 或用 `-s auto` 让模型自选 native(1024x1024 / 1024x1536 / 1536x1024),
   prompt 也保持通用语义

## 选参建议

`-q` 取值:`low / medium / high / xhigh / max / auto`,越高输出 token 越多、越慢。

| 意图 | 推荐参数 |
|---|---|
| 不确定尺寸 | `-s auto` + prompt 只说语义("landscape"/"portrait") |
| PPT/屏幕分享 16:9 | `-s 1920x1088` 或 `-s 2560x1440` |
| 手机短视频/Story 9:16 | `-s 1088x1920` |
| 正方形社交贴 | `-s 1024x1024`(预览) / `-s 2048x2048`(最终) |
| 4K UHD 最大细节 | `-s 3840x2160`(横) 或 `-s 2160x3840`(竖) |
| 探索候选 | flare + `-q low` 或 `medium` + `-n 3` |
| 一次性出图 | flare + `-q high` |
| 最终交付 | sunburst + `-q xhigh` |
| 极限细节(用户明确要求) | sunburst + `-q max` |
| 透明背景(图标/贴纸) | `-b transparent -f png`(或 `-f webp`) |
| 严格保持 + 只改局部 | sunburst `edit`,必要时加 `--mask` |
| 无 prompt 想做变体 | `edit --image src.png -p "a variation of this image"` |
| JPEG 压缩控制 | `-f jpeg --compression 80` |

## 常见错误处置

- `CONFIG_MISSING` → 引导用户 `config init` 或 `export OPENAI_API_KEY=...`
- `OPENAI_API_ERROR` `status=429` → 配额/限流,建议降 `-q` 或减 `-n`,或稍等后重试
- `OPENAI_API_ERROR` `status=400` `invalid_input_fidelity_model` → 去掉 `--input-fidelity`,2.5 不支持
- `OPENAI_API_ERROR` `status=400` 其他 → 读 `error.details.message`,通常是 prompt 或 size 不符合策略
- `OPENAI_API_ERROR` `status=404` `DeploymentNotFound` → Azure 上没有该 deployment,核对
  `--model` 值与 deployment 名是否一致
- `INVALID_INPUT quality must be one of` → `-q` 只接受 low/medium/high/xhigh/max/auto
- `INVALID_INPUT size dimensions must be multiples of 16` → 把边长对齐到最近的 16 的倍数
- `INVALID_INPUT size dimensions must be at most 3840px` → 超过 4K UHD 上限,降到 ≤ 3840
- `INVALID_INPUT total pixels must be ...` → 面积越界,要么整体缩小,要么换更不极端的比例
- `INVALID_INPUT aspect ratio must be between 3:1 and 1:3` → 比例过极端,改 21:9 以内
- `INVALID_INPUT` 透明背景 → `--background transparent` 要求 `--output-format png` 或 `webp`
- `IO_ERROR` → 检查 `--out` 目录是否存在且可写
- `NETWORK_ERROR` → 网络或 endpoint 配置异常,核对 `gpt-image-cli config show`

## 安全与预期

- flare 一张 1024x1024 通常几十秒,sunburst 约为其 1.5–2 倍;`edit` 比 `generate`
  略慢;大分辨率(≥ 4MP)、`xhigh`/`max`、`-n > 1` 会明显更慢更贵。
  单次实测参考(1024x1024):flare high 约 33 秒 / 1756 输出 tokens,sunburst high 约 60 秒,
  sunburst xhigh 约 90 秒 / 3122 输出 tokens,均会随负载波动。
- 超过 30 秒的调用先告诉用户"在生成,预计一分钟左右",再等结果。
- cwd 不合适时务必传 `--out`,不要在任意目录默认落盘。
- 不要把 API key 写进 shell history:用 `OPENAI_API_KEY` env 或 `config init`。
- 脚本场景首选 `--format json` + `--jq`,稳定可解析。

## 不要做

- 不要用本 SKILL 分析或识别现有图片(vision 任务,本 CLI 不覆盖)。
- 不要传 `--model` 以外的方式换模型(不要改 profile 的 deployment 字段来临时切换)。
- 不要自己拼 `curl` 调 OpenAI Images 端点 — 走 CLI,保证 envelope/错误路径统一。
- 不要在 prompt 里写与 `-s` 不一致的长宽比;画布和语义必须对齐。
- 不要在探索阶段用 sunburst 或 `xhigh`,那是纯浪费。
