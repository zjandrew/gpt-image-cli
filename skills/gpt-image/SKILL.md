---
name: gpt-image
version: 1.1.0
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
