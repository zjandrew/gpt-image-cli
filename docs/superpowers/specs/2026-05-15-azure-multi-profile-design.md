# Azure API support & multi-profile config — Design

**Status:** Approved (sections 1–4)
**Author:** andrew
**Date:** 2026-05-15
**Version target:** gpt-image-cli 1.1.0, skill 1.3.0

## Summary

Extend `gpt-image-cli` to support Azure OpenAI image generation alongside the existing public OpenAI endpoint, gated by named profiles. Users keep their current single-endpoint workflow with zero config changes (legacy config auto-migrates), and gain `config list` / `config use` to switch between any number of saved endpoints — public OpenAI, OpenAI-compatible proxies, and Azure deployments.

## Motivation

The current `~/.gpt-image-cli/config.json` holds one `{api_key, endpoint}` pair. Azure OpenAI has a substantially different request shape:

- URL: `{endpoint}/openai/deployments/{deployment}/images/generations?api-version={api_version}`
- Auth header: `api-key: <key>` (Microsoft default) or `Authorization: Bearer <token>` (Entra keyless, and the form used in the user's reference curl)
- No `model` field in body — model is the deployment in URL path
- No WEBP output

Supporting Azure inline forced a richer config model, and a richer config model justified going to named profiles instead of a flag-on-flag-off `provider_type` field. Multi-profile also covers the common case of "I have one key for personal, one for work, and a self-hosted proxy".

## Reference: Azure REST shape (verbatim from Microsoft Learn)

```
POST {endpoint}/openai/deployments/{deployment}/images/generations?api-version={api_version}
POST {endpoint}/openai/deployments/{deployment}/images/edits?api-version={api_version}

Headers (key-based):
  Content-Type: application/json   (generations)
  Content-Type: multipart/form-data (edits)
  api-key: <key>

Headers (Entra keyless OR user's curl-style bearer-as-key):
  Authorization: Bearer <token-or-key>
```

Body schema is the same as public OpenAI (`prompt`, `n`, `size`, `quality`, `output_format`, `output_compression`, `background`, `moderation`, `input_fidelity`, `mask`, `image`), except `model` is implicit and `output_format=webp` is rejected.

Response shape is identical: `{created, data: [{b64_json}]}`. Azure GPT-image series always returns `b64_json`, never `url`.

## Section 1 — Config file shape & migration

### v2 file format (`~/.gpt-image-cli/config.json`, mode 0600)

```json
{
  "version": 2,
  "active": "default",
  "profiles": {
    "default": {
      "type": "openai",
      "api_key": "sk-...",
      "endpoint": "https://api.openai.com/v1"
    },
    "azure-prod": {
      "type": "azure",
      "endpoint": "https://andrew-project-resource.openai.azure.com",
      "api_key": "1c4l...",
      "api_version": "2024-02-01",
      "deployment": "gpt-image-2",
      "auth_style": "bearer"
    }
  }
}
```

### Profile field rules

| field | openai | azure |
|---|---|---|
| `type` | `"openai"` | `"azure"` |
| `api_key` | required | required |
| `endpoint` | optional (default `https://api.openai.com/v1`) | required, **resource base URL only** (no `/openai/...` path) |
| `api_version` | — | required (e.g. `2024-02-01`, `2025-04-01-preview`) |
| `deployment` | — | required (used as the `model` parameter at request time) |
| `auth_style` | — | optional, `"api-key"` (default) \| `"bearer"` |

Validation regex for `api_version`: `^\d{4}-\d{2}-\d{2}(-preview)?$`.
Validation for azure `endpoint`: warn if it contains `/openai/deployments/`; the SDK appends that path itself.

### Auto-migration (silent, one-time)

When `readConfigFile()` sees a file missing `version` OR with top-level `api_key`/`endpoint`, it migrates in memory and rewrites the file with mode 0600:

```
{ "api_key": "X", "endpoint": "Y" }
   ↓
{ "version": 2,
  "active": "default",
  "profiles": {
    "default": { "type": "openai", "api_key": "X", "endpoint": "Y" }
  } }
```

Stderr notice once per migration: `[config] migrated legacy config to v2 (profile "default" created)`.

Env vars `OPENAI_API_KEY` / `OPENAI_BASE_URL` continue to behave as today and synthesize an implicit ad-hoc openai profile when no file exists.

## Section 2 — CLI command surface

### New profile commands

```
gpt-image-cli config list
  → table: NAME | TYPE | ENDPOINT | DEPLOYMENT | ACTIVE
    api_key redacted in all cases.

gpt-image-cli config use <name>
  → sets active=<name>; PROFILE_NOT_FOUND if missing.

gpt-image-cli config add <name> [--type openai|azure]
  → interactive wizard, type chosen first:
      openai: api_key (masked), endpoint (default https://api.openai.com/v1)
      azure:  endpoint, deployment, api_version (default 2024-02-01),
              api_key (masked), auth_style (default "api-key", 'b' for "bearer")
  → INVALID_INPUT if <name> already exists; use `config set` to edit instead.

gpt-image-cli config remove <name>
  → cannot remove active profile unless --yes; on removal of active,
    auto-switch to first remaining (alphabetical).

gpt-image-cli config show [<name>]
  → all fields of one profile (default: active), api_key redacted,
    sources annotated only when showing the active profile.
```

### Existing commands evolved

```
gpt-image-cli config init
  → unchanged surface; creates/replaces the "default" profile.
    Prompts for `type` first (defaults to "openai" for muscle-memory).

gpt-image-cli config set <key> <value> [--profile <name>]
  → operates on --profile or active. Per-type allowed keys:
      openai: api_key, endpoint
      azure:  api_key, endpoint, api_version, deployment, auth_style
  → rejects `type` (use add/remove); rejects keys foreign to the profile's type.

gpt-image-cli config get <key> [--profile <name>]
  → same scoping rule.

gpt-image-cli config path
  → unchanged.
```

### Global flags & env vars

```
--profile <name>            new; selects saved profile for this invocation
--endpoint <url>            unchanged; overrides selected profile's endpoint field
--api-key <key>             unchanged; overrides selected profile's api_key field

GPT_IMAGE_PROFILE           new; lower precedence than --profile, higher than file's `active`
OPENAI_API_KEY              unchanged; legacy ad-hoc openai
OPENAI_BASE_URL             unchanged; legacy ad-hoc openai
```

### Profile selection precedence

1. `--profile <name>` (flag)
2. `GPT_IMAGE_PROFILE` (env)
3. `active` field in config file
4. If no file but `--endpoint`/`--api-key`/`OPENAI_*` env set → synthesize ad-hoc openai profile
5. → `CONFIG_MISSING`

Once a profile is selected by the precedence chain above, `--endpoint` / `--api-key` (and their `OPENAI_*` env equivalents) override the *resolved* profile's `endpoint` / `api_key` fields for that invocation only. They never switch the profile's `type` — overriding an azure profile's `endpoint` leaves `type=azure`, `api_version`, `deployment`, and `auth_style` intact.

## Section 3 — Client factory & request flow

### New `makeClient` contract

```ts
// src/core/client.ts
import OpenAI, { AzureOpenAI } from "openai";

export interface ResolvedProfile {
  name: string;
  type: "openai" | "azure";
  apiKey: string;
  endpoint: string;
  apiVersion?: string;   // azure only
  deployment?: string;   // azure only
  authStyle?: "api-key" | "bearer";  // azure only
}

export interface ClientBundle {
  client: OpenAI | AzureOpenAI;
  model: string;          // "gpt-image-2" for openai; deployment name for azure
  profile: ResolvedProfile;
}

export function makeClient(flags: FlagConfigInput & { profile?: string }): ClientBundle;
```

### Branching inside `makeClient`

```ts
if (profile.type === "openai") {
  return {
    client: new OpenAI({ apiKey: profile.apiKey, baseURL: profile.endpoint }),
    model: "gpt-image-2",
    profile,
  };
}

const common = {
  endpoint: profile.endpoint,
  apiVersion: profile.apiVersion!,
  deployment: profile.deployment!,
};
const client = profile.authStyle === "bearer"
  ? new AzureOpenAI({ ...common, azureADTokenProvider: async () => profile.apiKey })
  : new AzureOpenAI({ ...common, apiKey: profile.apiKey });

return { client, model: profile.deployment!, profile };
```

The `azureADTokenProvider` indirection is how `Authorization: Bearer <key>` is achieved with the static key — no hand-rolled HTTP.

### `generate.ts` / `edit.ts` changes (minimal)

```diff
- const client = makeClient({ apiKey: global.apiKey, endpoint: global.endpoint });
- const request = { model: "gpt-image-2", prompt, ... };
+ const { client, model } = makeClient({ apiKey: global.apiKey, endpoint: global.endpoint, profile: global.profile });
+ const request = { model, prompt, ... };
```

The rest of the request body is identical across openai and azure.

### Envelope additions

Dry-run output gains a `profile` block:

```jsonc
{
  "ok": true,
  "data": {
    "operation": "generate",
    "profile": {
      "name": "azure-prod",
      "type": "azure",
      "endpoint": "https://andrew-project-resource.openai.azure.com",
      "deployment": "gpt-image-2",
      "auth_style": "bearer"
    },
    "request": { "model": "gpt-image-2", "prompt": "...", "size": "...", ... }
  }
}
```

Success envelope gains the same `profile` block so callers see which profile served the response.

`ImageOpResultData.model` widens from the literal `"gpt-image-2"` to `string` (deployment names are user-chosen on Azure).

### Verbose mode (`--verbose`)

Prints the constructed URL and redacted auth before the call:
```
[verbose] POST https://andrew-project-resource.openai.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2024-02-01
[verbose] auth: Bearer ***
```

## Section 4 — Validation, tests, rollout

### Per-profile validation deltas

- `output_format=webp` rejected when active profile is `azure`. Error: `INVALID_INPUT: webp not supported on Azure profile — use png or jpeg`.
- `size` rules unchanged — `gpt-image-2` accepts the same arbitrary-resolution grid on Azure.
- All other body fields (`quality`, `background`, `output_compression`, `moderation`, `input_fidelity`) pass through unchanged.

### Profile-add wizard validation

- Azure `endpoint`: warn (don't reject) if it contains `/openai/deployments/` — suggest the trimmed value.
- `api_version`: regex `^\d{4}-\d{2}-\d{2}(-preview)?$`.
- `deployment`: non-empty, no slashes.
- `auth_style`: enum `api-key` | `bearer`.

### New error code

`PROFILE_NOT_FOUND` — distinct from `CONFIG_MISSING`. Maps to exit code 2 (same family as `INVALID_INPUT`). Error `details` lists available profile names.

### Tests

`tests/unit/core/config.test.ts`:
1. v1 → v2 migration: reads correctly, rewrites file, emits stderr notice once, preserves 0600.
2. Profile CRUD: add → list → use → show → set → remove → list. File mode stays 0600 across rewrites.
3. Resolution precedence: `--profile` > `GPT_IMAGE_PROFILE` > file's `active`. Ad-hoc synthesis when no file exists.
4. Required-field validation at use time (not just at write time).

New `tests/unit/core/client.test.ts`:
5. Factory branches: openai → `OpenAI` instance with `baseURL`. azure+api-key → `AzureOpenAI` constructed with `apiKey` field. azure+bearer → `AzureOpenAI` constructed with `azureADTokenProvider` that resolves to the stored key.

`tests/integration/generate.test.ts` & `edit.test.ts` extensions:
6. WEBP rejection on azure for both commands.
7. `PROFILE_NOT_FOUND` envelope shape includes available-profiles list in `details`.
8. Azure call: assert SDK constructs base URL `{endpoint}/openai/deployments/{deployment}/images/generations` and includes `api-version=...` querystring.

No live Azure calls in tests — mock at the SDK / fetch layer.

### Rollout

- **SemVer**: minor bump → **1.1.0**. Adds capabilities, no breaking surface (legacy config auto-migrates; legacy flags/envs unchanged).
- **Files touched**:
  - `src/core/config.ts` — rewrite (v2 shape, migration, profile CRUD primitives)
  - `src/core/client.ts` — rewrite (branch by type; ~60 lines)
  - `src/commands/config.ts` — add `list`/`use`/`add`/`remove`/`show`, extend `init`/`set`/`get`
  - `src/commands/generate.ts` & `src/commands/edit.ts` — consume `{client, model}` from factory; WEBP guard
  - `src/framework/types.ts` — add `ResolvedProfile`, `ProfileType`, `PROFILE_NOT_FOUND`
  - `src/framework/errors.ts` — new code + exit-code mapping
  - `src/index.ts` — register new flags (`--profile`), bump VERSION to `1.1.0`
  - `tests/unit/core/config.test.ts` — extended; `tests/unit/core/client.test.ts` — new
  - `tests/integration/*.test.ts` — extended
- **SKILL.md** (`skills/gpt-image/SKILL.md`): add a "Multi-profile setup" section with both `config add` flows + note that WEBP is unsupported on Azure. Bump skill frontmatter to 1.3.0.
- **README.md**: append "Azure OpenAI" section with wizard transcript and resulting JSON.
- **Commit / release**: conventional commit `feat: add Azure OpenAI support via multi-profile config`. Tag `v1.1.0`, push to GitHub, publish to npm.

### Known limitations after this change

- Azure profiles only support static-key Bearer (via `azureADTokenProvider: async () => key`). True Microsoft Entra keyless (`DefaultAzureCredential` → token refresh) is **not** implemented — a future profile field `auth_style: "entra"` can be added without breaking the v2 file shape.
- Streaming responses (`stream: true`, `partial_images`) remain out of scope — the CLI is one-shot.
