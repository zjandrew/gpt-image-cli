# gpt-image-cli

CLI for OpenAI `gpt-image-2` — text-to-image and image editing — with an accompanying SKILL for Claude Code / AI agents.

## Install

```bash
# CLI (global):
npm install -g @zhoujinandrew/gpt-image-cli

# Companion SKILL for Claude Code:
npx skills add zjandrew/gpt-image-cli -g -y
```

Local development:

```bash
git clone https://github.com/zjandrew/gpt-image-cli.git
cd gpt-image-cli
npm install
npm run build
npm link
```

## Configure

```bash
# Interactive wizard (creates ~/.gpt-image-cli/config.json, chmod 600):
gpt-image-cli config init

# Or env vars:
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://api.openai.com/v1   # optional

# Or programmatic:
gpt-image-cli config set api_key sk-...
gpt-image-cli config set endpoint https://proxy.example.com/v1
```

Priority: CLI flag > env var > config file > default.

### Multiple endpoints / profiles

`gpt-image-cli` supports multiple named profiles — public OpenAI, OpenAI-compatible proxies, and Azure OpenAI deployments side-by-side.

```bash
# List all saved profiles
gpt-image-cli config list

# Add a new Azure profile (interactive wizard)
gpt-image-cli config add azure-prod --type azure
# prompts:
#   Azure endpoint:    https://<resource>.openai.azure.com
#   Deployment name:   gpt-image-2
#   api-version:       2024-02-01
#   API key:           ********
#   auth_style:        api-key       (default; or "bearer")

# Switch active profile
gpt-image-cli config use azure-prod

# Per-invocation override without switching active
gpt-image-cli --profile azure-prod generate -p "..." --out a.png
```

The resulting config (`~/.gpt-image-cli/config.json`, chmod 600):

```json
{
  "version": 2,
  "active": "azure-prod",
  "profiles": {
    "default": {
      "type": "openai",
      "api_key": "sk-...",
      "endpoint": "https://api.openai.com/v1"
    },
    "azure-prod": {
      "type": "azure",
      "endpoint": "https://<resource>.openai.azure.com",
      "api_key": "...",
      "api_version": "2024-02-01",
      "deployment": "gpt-image-2",
      "auth_style": "bearer"
    }
  }
}
```

Legacy single-endpoint configs are auto-migrated to a `default` profile on first read.

Profile selection precedence: `--profile <name>` flag > `GPT_IMAGE_PROFILE` env > config file's `active`. `--endpoint` / `--api-key` flags override the resolved profile's fields without changing its `type`.

Notes on Azure profiles:
- `output_format=webp` is rejected — Azure only supports `png` and `jpeg`.
- `auth_style: "bearer"` sends `Authorization: Bearer <key>` (matches the format some Azure gateways accept). Default `api-key` sends `api-key: <key>` per Microsoft's standard.
- `endpoint` is the bare resource URL (`https://<resource>.openai.azure.com`) — do not include `/openai/deployments/...`; the SDK appends that.

## Usage

### Generate

```bash
gpt-image-cli generate -p "a tabby cat wearing a red scarf" -s 1024x1024 -q high --out cat.png
```

### Edit

```bash
gpt-image-cli edit --image cat.png -p "add a top hat" --out hatted.png
gpt-image-cli edit --image a.png --image b.png -p "combine them" --out combined.png
gpt-image-cli edit --image scene.png --mask mask.png -p "replace the sky" --out new.png
```

### Pipe base64

```bash
gpt-image-cli generate -p "..." --stdout-base64 2>/dev/null | base64 -d > out.png
```

### Dry-run

```bash
gpt-image-cli generate -p "..." --dry-run
```

## SKILL

The skill lives at `skills/gpt-image/SKILL.md`. Install to your Claude Code skills:

```bash
npx skills add zjandrew/gpt-image-cli -g -y
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 2 | INVALID_INPUT / CONFIG_MISSING |
| 3 | IO_ERROR |
| 4 | OPENAI_API_ERROR |
| 5 | NETWORK_ERROR |
| 10 | INTERNAL |

## License

MIT
