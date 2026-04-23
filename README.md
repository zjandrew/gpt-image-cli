# gpt-image-cli

CLI for OpenAI `gpt-image-2` — text-to-image and image editing — with an accompanying SKILL for Claude Code / AI agents.

## Install

```bash
# Once published:
npm i -g gpt-image-cli

# Local development:
git clone <repo> && cd gpt-image-cli
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
npx skills add <this-repo> -g -y
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
