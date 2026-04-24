---
name: gpt-image
version: 1.2.0
description: "当用户需要生成图片、修图、加元素、抠背景、替换场景,或多轮迭代优化图片(生成预览 → 反馈 → 改版)时使用。"
metadata:
  requires:
    bins: ["gpt-image-cli"]
  cliHelp: "gpt-image-cli --help"
---

# gpt-image

一句话:本 SKILL 驱动 `gpt-image-cli`,用 OpenAI `gpt-image-2` 模型生成或编辑图片。

**核心原则**:统一走 `gpt-image-cli` 入口(不手拼 curl);每次生图后必 `Read`
本轮刚写的 PNG 再汇报;多轮优化时靠 prompt 显式重述视觉要素,不靠模型记忆。

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
- 控制画幅/质量:`-s 1920x1088 -q high`
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

## 多轮优化(预览 → 反馈 → 再生成)

一个"生成预览 → 用户看 → 提反馈 → 重新生成"的对话闭环,**全程走 `generate`
不走 `edit`**。由 Claude 自己担任编排器——Claude 是多模态模型,`Read` 打开
PNG 就能看见画面——所以**不需要 gpt-4.1-mini / Responses API / 额外 LLM 费用**。

### 触发条件

用户说"先给我看一版"、"出一张我看看再调"、"多轮优化"、"生成 → 反馈 → 修改",
或在第一版出来后继续描述修改意见(而非要求整体重画)。

### 工作流

**Step 1 – 初版生成:**

1. 给这次优化开专属子目录:`./refine/<topic>/`
   - `<topic>`:取自用户对此次优化的简短命名(若用户没给,用任务语义自造一个
     kebab-case 词,如 `poster-hero`、`logo-navy`)
   - 若 `./refine/<topic>/v1.png` 已存在,改用带时间戳的子目录
     `./refine/<topic>-<YYYYMMDD-HHMM>/`,避免覆盖历史轮次
2. 选定 `-s`、`-q` 后 `generate`,产物写到 `v1.png`
3. 生成后**立即**用 `Read` 打开**本轮刚写的这张 PNG**
   (不是 context 里的旧图、不是凭记忆)。你是多模态模型,看得见
4. 回报用户:路径 + 一句关键视觉要素总结
   ("已出 v1:深蓝背景 / 居中 Logo / 金色衬线字")

**Step 2 – 收反馈:** 等用户说具体修改意见。太模糊("再好看点")先问一句澄清,别硬猜。

**Step 3 – 重写 prompt(核心):**

照下面 4 段模板**填充**,不是自由发挥。每段都基于 Step 1.3 刚 `Read` 到的那张图:

```
[主体与构图]:<上一张图里主角是什么、怎么摆、视角方向>
[配色与风格]:<主色调、辅色、质感、艺术风格>
[关键细节]:<文字/LOGO/小物件/标识等绝不能丢的元素>
[本轮修改]:<用户这次提的反馈,作为增量叠加不替换>
```

然后把这 4 段**展开成一段自洽的自然语言 prompt**(不要把 `[...]` 标签带进去)。

规则:
- **不要**写 "like before but brighter" / "保持原样只改 X" ——gpt-image-2
  没有上下文,它不懂"before"和"原样"。每轮 prompt 必须**完整自包含**
- `-s`、`-q`、`-f` 等画布参数**跨轮保持不变**,便于 A/B 比对
- 每段 1-2 句,整体 prompt 控制在 200 字内,别堆成 500 字大段

**Step 4 – 再生成:** 同目录写 `v2.png`(严格递增不覆盖)→ 再次 `Read` 本轮新图 →
告诉用户"v2 相对 v1 改动了 X / 保留了 Y",再等反馈。

**Step 5 – 回 Step 2,直到用户满意。** 可让用户点名某一版定稿,复制为 `final.png`
(执行 `cp refine/<topic>/vN.png refine/<topic>/final.png`)。

### 产物命名

```
refine/<topic>/
├── v1.png      # 基线
├── v2.png      # 迭代
├── v3.png
└── final.png   # 可选,用户定稿时 copy
```

同轮想要多候选就用 `-n`,命名 `v1a.png / v1b.png / v1c.png`,让用户挑一个做下轮基线。

### 必须做

- 每轮生成后 `Read` **本轮刚写的** PNG(不是旧图、不是凭记忆)
- 新 prompt **完整自洽**:按 4 段模板重述保留要素 + 叠加修改,不用相对描述
- 画布尺寸、比例、质量跨轮**稳定**
- 每轮明确告诉用户"改了什么 / 保留了什么"

### 必须不做

- 不要悄悄切换到 `edit` 接口——用户选了 generate 路线就走到底
- 不要用"保持原样只改 XX"这类相对 prompt,gpt-image-2 不懂"原样"
- 不要跨轮改 `-s`,会造成构图大跳
- 不要把多轮 prompt 拼成一长串历史塞给模型,gpt-image-2 不当它对话上下文看
- 不要生成完不 `Read` 就给用户总结——你没看就不知道模型画了什么

### Red Flags — 出现这些信号立即停下

- 我正要凭记忆写下一版 prompt → **停**,先 `Read` 刚生成的图
- 我正要写 "keep the previous but..." → **停**,按 4 段模板重写完整 prompt
- 我正要把 `-s` 换一个值 → **停**,先问用户是否要换构图(会打断 A/B 对比)
- 我正要省掉 `Read` 直接汇报 → **停**,没看等于不知道模型画了什么

### 局限与兜底

gpt-image-2 每轮都是"从零构图",**即便你重述视觉要素,仍会有轻微漂移**
(姿态、小道具细节等)。这是模型层特性,不是 SKILL 问题。

**如果用户要求像素级保留某元素**(人脸 / LOGO / 品牌色值):多轮优化不是对的工具。
给用户一句话切换提示,例如:
> "这个诉求对保真度要求高,建议切到 `edit --input-fidelity high` 路线,
> 拿 v_N.png 当基底直接改。要我切换吗?"

本工作流适合**语义级**迭代调优(配色倾向、整体氛围、构图方向),不适合精细保真。

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

| 意图 | 推荐参数 |
|---|---|
| 不确定尺寸 | `-s auto` + prompt 只说语义("landscape"/"portrait") |
| PPT/屏幕分享 16:9 | `-s 1920x1088` 或 `-s 2560x1440` |
| 手机短视频/Story 9:16 | `-s 1088x1920` |
| 正方形社交贴 | `-s 1024x1024`(预览) / `-s 2048x2048`(最终) |
| 4K UHD 最大细节 | `-s 3840x2160`(横) 或 `-s 2160x3840`(竖) |
| 快速草图/预览 | `-q low` |
| 最终产出 | `-q high` |
| 透明背景(图标/贴纸) | `-b transparent -f png`(或 `-f webp`) |
| 人像/品牌细节 | `edit --input-fidelity high` |
| 无 prompt 想做变体 | `edit --image src.png -p "a variation of this image"` |
| JPEG 压缩控制 | `-f jpeg --compression 80` |

## 常见错误处置

- `CONFIG_MISSING` → 引导用户 `config init` 或 `export OPENAI_API_KEY=...`
- `OPENAI_API_ERROR` `status=429` → 配额/限流,建议降 `-q` 或减 `-n`,或稍等后重试
- `OPENAI_API_ERROR` `status=400` → 读 `error.details.message`,通常是 prompt 或 size 不符合策略
- `INVALID_INPUT size dimensions must be multiples of 16` → 把边长对齐到最近的 16 的倍数
- `INVALID_INPUT size dimensions must be at most 3840px` → 超过 4K UHD 上限,降到 ≤ 3840
- `INVALID_INPUT total pixels must be ...` → 面积越界,要么整体缩小,要么换更不极端的比例
- `INVALID_INPUT aspect ratio must be between 3:1 and 1:3` → 比例过极端,改 21:9 以内
- `INVALID_INPUT` 透明背景 → `--background transparent` 要求 `--output-format png` 或 `webp`
- `IO_ERROR` → 检查 `--out` 目录是否存在且可写
- `NETWORK_ERROR` → 网络或 endpoint 配置异常,核对 `gpt-image-cli config show`

## 安全与预期

- 单次调用耗时数秒至数十秒,大分辨率(≥ 4MP)或 `-n > 1` 会明显更慢更贵,非必要别放大。
- cwd 不合适时务必传 `--out`,不要在任意目录默认落盘。
- 不要把 API key 写进 shell history:用 `OPENAI_API_KEY` env 或 `config init`。
- 脚本场景首选 `--format json` + `--jq`,稳定可解析。

## 不要做

- 不要用本 SKILL 分析或识别现有图片(vision 任务,本 CLI 不覆盖)。
- 不要尝试调用除 `gpt-image-2` 以外的 model-id(CLI 写死 `gpt-image-2`,无 `--model` flag)。
- 不要自己拼 `curl` 调 OpenAI Images 端点 — 走 CLI,保证 envelope/错误路径统一。
- 不要在 prompt 里写与 `-s` 不一致的长宽比;画布和语义必须对齐。
