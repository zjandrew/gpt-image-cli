# gpt-image-cli Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a TypeScript CLI (`gpt-image-cli`) that generates and edits images via OpenAI `gpt-image-2` (Images API only), plus a single Chinese SKILL.md that teaches Claude Code how to drive it.

**Architecture:** Flat `generate` / `edit` / `config` subcommands. Three-layer src: `framework/` (types, envelope, errors) → `core/` (config, openai client, image input) → `commands/`. `{ok,data}` JSON envelope on stdout, auto-named file output, config priority `flag > env > ~/.gpt-image-cli/config.json > default`. Hardcoded `model: "gpt-image-2"`, no `--model` flag.

**Tech Stack:** Node ≥18 (ESM) · TypeScript · `commander` · `openai` SDK · `mime` · `cli-table3` · `tsup` bundler · `vitest` + `msw` tests.

**Spec:** `docs/superpowers/specs/2026-04-23-gpt-image-cli-design.md`

---

## File Map

**Source:**
- `src/index.ts` — Commander program wiring, global flag registration, command loading.
- `src/framework/types.ts` — `Config`, `OutputEnvelope`, `ErrorCode`, `GlobalOptions`.
- `src/framework/output.ts` — envelope formatting (`json` / `table`), `--jq` filter, stdout/stderr split for `--stdout-base64`.
- `src/framework/errors.ts` — `CliError` class, error-code → exit-code mapping, SDK error translator.
- `src/core/config.ts` — config resolve (flag/env/file/default), file read/write with `chmod`.
- `src/core/client.ts` — OpenAI client factory (injects `apiKey` + `baseURL`).
- `src/core/image-input.ts` — `--image` / `--mask` resolver: local path or URL → `{ buffer, filename, mime }`.
- `src/core/naming.ts` — auto-name generator (`gpt-image-<ts>[-<idx>][-<hash>].<ext>`), out-path resolver (dir vs file).
- `src/commands/generate.ts` — `generate` subcommand: validate → SDK call → write files → emit envelope.
- `src/commands/edit.ts` — `edit` subcommand: same pipeline with image/mask/input-fidelity.
- `src/commands/config.ts` — `config init` / `set` / `get` / `show` / `path`.

**Packaging:**
- `package.json` — bin, files, scripts, deps.
- `bin/gpt-image-cli.js` — shebang + dist loader.
- `tsconfig.json`, `tsup.config.ts`, `.gitignore`, `vitest.config.ts`.

**SKILL & docs:**
- `skills/gpt-image/SKILL.md` — single-file Chinese SKILL with frontmatter.
- `README.md` — install, config, generate/edit examples, SKILL install.
- `scripts/smoke.sh` — real-API manual smoke.

**Tests:**
- `tests/unit/framework/output.test.ts`
- `tests/unit/framework/errors.test.ts`
- `tests/unit/core/config.test.ts`
- `tests/unit/core/image-input.test.ts`
- `tests/unit/core/naming.test.ts`
- `tests/integration/generate.test.ts` (msw)
- `tests/integration/edit.test.ts` (msw)
- `tests/fixtures/` — sample PNGs for edit tests.

---

## Task 1: Scaffold repo and tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `.gitignore`, `bin/gpt-image-cli.js`, `src/index.ts` (stub)

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "gpt-image-cli",
  "version": "1.0.0",
  "description": "CLI for OpenAI gpt-image-2 generation and editing",
  "type": "module",
  "bin": { "gpt-image-cli": "./bin/gpt-image-cli.js" },
  "main": "dist/index.js",
  "files": ["bin/", "dist/", "skills/", "README.md"],
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsup src/index.ts --format esm --outDir dist --clean",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit",
    "prepublishOnly": "npm run lint && npm run test && npm run build"
  },
  "engines": { "node": ">=18.0.0" },
  "dependencies": {
    "cli-table3": "^0.6.5",
    "commander": "^12.1.0",
    "mime": "^4.0.4",
    "openai": "^4.73.0"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "msw": "^2.4.0",
    "tsup": "^8.2.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "esModuleInterop": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Write `tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  target: "node18",
  shims: false,
  splitting: false,
});
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    testTimeout: 10000,
  },
});
```

- [ ] **Step 5: Write `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
.env
.env.*
tmp/
```

- [ ] **Step 6: Write `bin/gpt-image-cli.js`**

```js
#!/usr/bin/env node
import("../dist/index.js").catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Then `chmod +x bin/gpt-image-cli.js`.

- [ ] **Step 7: Write stub `src/index.ts`**

```ts
import { Command } from "commander";

const program = new Command();
program.name("gpt-image-cli").version("1.0.0").description("OpenAI gpt-image-2 CLI");
program.parse(process.argv);
```

- [ ] **Step 8: Install deps and verify build**

Run: `npm install && npm run build && node dist/index.js --version`
Expected: prints `1.0.0`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsup.config.ts vitest.config.ts .gitignore bin/ src/index.ts
git commit -m "chore: scaffold repo with commander, tsup, vitest"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/framework/types.ts`

- [ ] **Step 1: Write the types**

```ts
// src/framework/types.ts

export interface Config {
  apiKey: string;
  endpoint: string;
}

export type ConfigSource = "flag" | "env" | "file" | "default" | "missing";

export interface ConfigResolution {
  config: Partial<Config>;
  sources: { apiKey: ConfigSource; endpoint: ConfigSource };
}

export type ErrorCode =
  | "CONFIG_MISSING"
  | "INVALID_INPUT"
  | "IO_ERROR"
  | "OPENAI_API_ERROR"
  | "NETWORK_ERROR"
  | "INTERNAL";

export interface SuccessEnvelope<T = unknown> {
  ok: true;
  data: T;
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type OutputEnvelope = SuccessEnvelope | ErrorEnvelope;

export interface GlobalOptions {
  endpoint?: string;
  apiKey?: string;
  format: "json" | "table";
  jq?: string;
  dryRun: boolean;
  yes: boolean;
  verbose: boolean;
}

export interface ImageOpResultData {
  model: "gpt-image-2";
  operation: "generate" | "edit";
  paths: string[];
  size: string;
  quality: string;
  output_format: string;
  count: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

export interface EmitOptions {
  /** Route the envelope to stderr instead of stdout. Used by --stdout-base64. */
  toStderr?: boolean;
}

export type Emitter = (env: OutputEnvelope, opts?: EmitOptions) => void;
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/framework/types.ts
git commit -m "feat: shared types for config, envelope, image ops"
```

---

## Task 3: Output envelope (JSON + table + jq)

**Files:**
- Create: `src/framework/output.ts`
- Test: `tests/unit/framework/output.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/framework/output.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderEnvelope, applyJq } from "../../../src/framework/output.js";
import type { OutputEnvelope } from "../../../src/framework/types.js";

describe("renderEnvelope json", () => {
  it("prints envelope as pretty JSON", () => {
    const env: OutputEnvelope = { ok: true, data: { paths: ["a.png"] } };
    expect(renderEnvelope(env, { format: "json" })).toBe(
      JSON.stringify(env, null, 2),
    );
  });
});

describe("renderEnvelope table", () => {
  it("renders success envelope as table", () => {
    const env: OutputEnvelope = {
      ok: true,
      data: {
        model: "gpt-image-2",
        operation: "generate",
        paths: ["a.png"],
        size: "1024x1024",
        quality: "high",
        output_format: "png",
        count: 1,
      },
    };
    const out = renderEnvelope(env, { format: "table" });
    expect(out).toContain("paths");
    expect(out).toContain("a.png");
    expect(out).toContain("1024x1024");
  });

  it("falls back to JSON on error envelope", () => {
    const env: OutputEnvelope = {
      ok: false,
      error: { code: "INVALID_INPUT", message: "bad prompt" },
    };
    const out = renderEnvelope(env, { format: "table" });
    expect(out).toContain('"INVALID_INPUT"');
  });
});

describe("applyJq", () => {
  it("returns input unchanged when expr is empty", () => {
    const env = { ok: true, data: { x: 1 } };
    expect(applyJq(env, undefined)).toEqual(env);
  });

  it("extracts a single field", () => {
    const env = { ok: true, data: { paths: ["a.png", "b.png"] } };
    expect(applyJq(env, ".data.paths[0]")).toBe("a.png");
  });

  it("throws on invalid expr", () => {
    expect(() => applyJq({ ok: true }, "bogus[[")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npm test -- tests/unit/framework/output.test.ts`
Expected: FAIL — `renderEnvelope`/`applyJq` not found.

- [ ] **Step 3: Implement `src/framework/output.ts`**

```ts
// src/framework/output.ts
import Table from "cli-table3";
import type { OutputEnvelope } from "./types.js";

export interface RenderOptions {
  format: "json" | "table";
}

export function renderEnvelope(env: OutputEnvelope, opts: RenderOptions): string {
  if (opts.format === "table" && env.ok) {
    return renderTable(env.data as Record<string, unknown>);
  }
  return JSON.stringify(env, null, 2);
}

function renderTable(data: Record<string, unknown>): string {
  const table = new Table({ head: ["field", "value"] });
  for (const [k, v] of Object.entries(data)) {
    table.push([k, formatValue(v)]);
  }
  return table.toString();
}

function formatValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => String(x)).join("\n");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Tiny jq-subset: supports `.a.b[0].c` style paths. No filters, pipes, or
// functions — this is deliberately minimal. Throws on syntax errors.
export function applyJq(value: unknown, expr: string | undefined): unknown {
  if (!expr) return value;
  const path = parseJqPath(expr);
  let cur: unknown = value;
  for (const seg of path) {
    if (cur == null) return null;
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) throw new Error(`jq: expected array at ${expr}`);
      cur = cur[seg];
    } else {
      if (typeof cur !== "object") throw new Error(`jq: expected object at ${expr}`);
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

type JqSegment = string | number;

function parseJqPath(expr: string): JqSegment[] {
  const trimmed = expr.trim();
  if (trimmed === "." || trimmed === "") return [];
  if (!trimmed.startsWith(".")) throw new Error(`jq: expression must start with '.': ${expr}`);
  const segments: JqSegment[] = [];
  // Match .name or [int]
  const re = /\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    if (m.index !== idx) throw new Error(`jq: parse error near '${trimmed.slice(idx)}'`);
    if (m[1] !== undefined) segments.push(m[1]);
    else if (m[2] !== undefined) segments.push(parseInt(m[2], 10));
    idx = re.lastIndex;
  }
  if (idx !== trimmed.length) throw new Error(`jq: parse error near '${trimmed.slice(idx)}'`);
  return segments;
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npm test -- tests/unit/framework/output.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/framework/output.ts tests/unit/framework/output.test.ts
git commit -m "feat(framework): envelope renderer with json, table, and tiny jq"
```

---

## Task 4: Error class and exit-code mapping

**Files:**
- Create: `src/framework/errors.ts`
- Test: `tests/unit/framework/errors.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/framework/errors.test.ts
import { describe, it, expect } from "vitest";
import {
  CliError,
  exitCodeFor,
  translateOpenAIError,
} from "../../../src/framework/errors.js";

describe("CliError", () => {
  it("stores code, message, details", () => {
    const err = new CliError("INVALID_INPUT", "bad", { field: "size" });
    expect(err.code).toBe("INVALID_INPUT");
    expect(err.message).toBe("bad");
    expect(err.details).toEqual({ field: "size" });
  });

  it("toEnvelope produces error envelope", () => {
    const env = new CliError("IO_ERROR", "cannot write").toEnvelope();
    expect(env).toEqual({
      ok: false,
      error: { code: "IO_ERROR", message: "cannot write", details: undefined },
    });
  });
});

describe("exitCodeFor", () => {
  it("maps codes", () => {
    expect(exitCodeFor("CONFIG_MISSING")).toBe(2);
    expect(exitCodeFor("INVALID_INPUT")).toBe(2);
    expect(exitCodeFor("IO_ERROR")).toBe(3);
    expect(exitCodeFor("OPENAI_API_ERROR")).toBe(4);
    expect(exitCodeFor("NETWORK_ERROR")).toBe(5);
    expect(exitCodeFor("INTERNAL")).toBe(10);
  });
});

describe("translateOpenAIError", () => {
  it("wraps APIError with status & code", () => {
    const apiErr: any = new Error("quota");
    apiErr.status = 429;
    apiErr.code = "quota_exceeded";
    apiErr.type = "insufficient_quota";
    const cli = translateOpenAIError(apiErr);
    expect(cli.code).toBe("OPENAI_API_ERROR");
    expect(cli.details).toMatchObject({
      status: 429,
      code: "quota_exceeded",
      type: "insufficient_quota",
    });
  });

  it("detects network errors by code", () => {
    const netErr: any = new Error("ENOTFOUND");
    netErr.code = "ENOTFOUND";
    const cli = translateOpenAIError(netErr);
    expect(cli.code).toBe("NETWORK_ERROR");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- tests/unit/framework/errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/framework/errors.ts`**

```ts
// src/framework/errors.ts
import type { ErrorCode, ErrorEnvelope } from "./types.js";

export class CliError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CliError";
  }

  toEnvelope(): ErrorEnvelope {
    return {
      ok: false,
      error: { code: this.code, message: this.message, details: this.details },
    };
  }
}

const EXIT_CODES: Record<ErrorCode, number> = {
  CONFIG_MISSING: 2,
  INVALID_INPUT: 2,
  IO_ERROR: 3,
  OPENAI_API_ERROR: 4,
  NETWORK_ERROR: 5,
  INTERNAL: 10,
};

export function exitCodeFor(code: ErrorCode): number {
  return EXIT_CODES[code];
}

const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

export function translateOpenAIError(err: unknown): CliError {
  if (err instanceof CliError) return err;
  const anyErr = err as { status?: number; code?: string; type?: string; message?: string };
  if (anyErr.code && NETWORK_CODES.has(anyErr.code)) {
    return new CliError("NETWORK_ERROR", anyErr.message ?? "network error", {
      code: anyErr.code,
    });
  }
  if (typeof anyErr.status === "number") {
    return new CliError("OPENAI_API_ERROR", anyErr.message ?? "OpenAI API error", {
      status: anyErr.status,
      code: anyErr.code,
      type: anyErr.type,
    });
  }
  return new CliError("INTERNAL", anyErr.message ?? "unknown error");
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- tests/unit/framework/errors.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/framework/errors.ts tests/unit/framework/errors.test.ts
git commit -m "feat(framework): CliError, exit-code map, OpenAI translator"
```

---

## Task 5: Config resolve + file IO

**Files:**
- Create: `src/core/config.ts`
- Test: `tests/unit/core/config.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/core/config.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolveConfig,
  readConfigFile,
  writeConfigFile,
  configFilePath,
} from "../../../src/core/config.js";

describe("resolveConfig priority", () => {
  const origEnv = { ...process.env };
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-image-cli-test-"));
    process.env.HOME = tmpHome;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("uses default endpoint when nothing is set", () => {
    const r = resolveConfig({});
    expect(r.config.endpoint).toBe("https://api.openai.com/v1");
    expect(r.sources.endpoint).toBe("default");
    expect(r.sources.apiKey).toBe("missing");
  });

  it("flag beats env beats file beats default", () => {
    writeConfigFile({ api_key: "from-file", endpoint: "from-file" });
    process.env.OPENAI_API_KEY = "from-env";
    process.env.OPENAI_BASE_URL = "from-env";
    const r = resolveConfig({ apiKey: "from-flag", endpoint: "from-flag" });
    expect(r.config.apiKey).toBe("from-flag");
    expect(r.config.endpoint).toBe("from-flag");
    expect(r.sources.apiKey).toBe("flag");
    expect(r.sources.endpoint).toBe("flag");
  });

  it("env wins when no flag", () => {
    writeConfigFile({ api_key: "from-file" });
    process.env.OPENAI_API_KEY = "from-env";
    const r = resolveConfig({});
    expect(r.config.apiKey).toBe("from-env");
    expect(r.sources.apiKey).toBe("env");
  });

  it("file is used when flag+env absent", () => {
    writeConfigFile({ api_key: "from-file", endpoint: "https://proxy/v1" });
    const r = resolveConfig({});
    expect(r.config.apiKey).toBe("from-file");
    expect(r.config.endpoint).toBe("https://proxy/v1");
    expect(r.sources.apiKey).toBe("file");
    expect(r.sources.endpoint).toBe("file");
  });
});

describe("config file IO", () => {
  const origEnv = { ...process.env };
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-image-cli-test-"));
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("writes and reads back", () => {
    writeConfigFile({ api_key: "k", endpoint: "e" });
    const read = readConfigFile();
    expect(read).toEqual({ api_key: "k", endpoint: "e" });
  });

  it("returns empty object when file does not exist", () => {
    expect(readConfigFile()).toEqual({});
  });

  it("sets 0600 permissions on file", () => {
    writeConfigFile({ api_key: "k" });
    const stat = fs.statSync(configFilePath());
    // Mask to permission bits; 0600 octal = 384 decimal
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("omits empty string fields", () => {
    writeConfigFile({ api_key: "", endpoint: "e" });
    expect(readConfigFile()).toEqual({ endpoint: "e" });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- tests/unit/core/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/config.ts`**

```ts
// src/core/config.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ConfigResolution, ConfigSource } from "../framework/types.js";

const DEFAULT_ENDPOINT = "https://api.openai.com/v1";

export interface ConfigFile {
  api_key?: string;
  endpoint?: string;
}

export interface FlagConfigInput {
  apiKey?: string;
  endpoint?: string;
}

function home(): string {
  return process.env.HOME ?? os.homedir();
}

export function configDir(): string {
  return path.join(home(), ".gpt-image-cli");
}

export function configFilePath(): string {
  return path.join(configDir(), "config.json");
}

export function readConfigFile(): ConfigFile {
  const p = configFilePath();
  if (!fs.existsSync(p)) return {};
  const raw = fs.readFileSync(p, "utf8");
  const parsed = JSON.parse(raw) as ConfigFile;
  return parsed;
}

export function writeConfigFile(cfg: ConfigFile): void {
  const dir = configDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const clean: ConfigFile = {};
  if (cfg.api_key) clean.api_key = cfg.api_key;
  if (cfg.endpoint) clean.endpoint = cfg.endpoint;
  const p = configFilePath();
  fs.writeFileSync(p, JSON.stringify(clean, null, 2), { mode: 0o600 });
  fs.chmodSync(p, 0o600);
}

export function resolveConfig(flags: FlagConfigInput): ConfigResolution {
  const file = readConfigFile();

  const pick = (
    flag: string | undefined,
    env: string | undefined,
    fileVal: string | undefined,
    fallback: string | undefined,
  ): [string | undefined, ConfigSource] => {
    if (flag) return [flag, "flag"];
    if (env) return [env, "env"];
    if (fileVal) return [fileVal, "file"];
    if (fallback !== undefined) return [fallback, "default"];
    return [undefined, "missing"];
  };

  const [apiKey, apiKeySrc] = pick(
    flags.apiKey,
    process.env.OPENAI_API_KEY,
    file.api_key,
    undefined,
  );
  const [endpoint, endpointSrc] = pick(
    flags.endpoint,
    process.env.OPENAI_BASE_URL,
    file.endpoint,
    DEFAULT_ENDPOINT,
  );

  return {
    config: {
      ...(apiKey ? { apiKey } : {}),
      ...(endpoint ? { endpoint } : {}),
    },
    sources: { apiKey: apiKeySrc, endpoint: endpointSrc },
  };
}

export function redactApiKey(k: string | undefined): string {
  if (!k) return "(unset)";
  if (k.length <= 8) return "sk-***";
  return `sk-***${k.slice(-4)}`;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- tests/unit/core/config.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts tests/unit/core/config.test.ts
git commit -m "feat(core): config resolve (flag>env>file>default) + file IO"
```

---

## Task 6: OpenAI client factory

**Files:**
- Create: `src/core/client.ts`

- [ ] **Step 1: Implement `src/core/client.ts`**

This is a thin factory; no unit test (exercised by integration tests later).

```ts
// src/core/client.ts
import OpenAI from "openai";
import { CliError } from "../framework/errors.js";
import { resolveConfig, type FlagConfigInput } from "./config.js";

export function makeClient(flags: FlagConfigInput): OpenAI {
  const { config, sources } = resolveConfig(flags);
  if (!config.apiKey) {
    throw new CliError(
      "CONFIG_MISSING",
      "OpenAI API key not set. Set OPENAI_API_KEY or run `gpt-image-cli config init`.",
    );
  }
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.endpoint,
  });
}

export function describeConfigSources(flags: FlagConfigInput): {
  apiKey: string;
  endpoint: string;
} {
  const { sources } = resolveConfig(flags);
  return sources;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/client.ts
git commit -m "feat(core): OpenAI client factory with CliError on missing key"
```

---

## Task 7: Image input resolver (path or URL → Buffer + mime)

**Files:**
- Create: `src/core/image-input.ts`
- Test: `tests/unit/core/image-input.test.ts`
- Create fixture: `tests/fixtures/tiny.png`

- [ ] **Step 1: Create the fixture PNG**

Run:
```bash
mkdir -p tests/fixtures
# 1x1 transparent PNG, base64-decoded to a real file
node -e "import('node:fs').then(m=>m.writeFileSync('tests/fixtures/tiny.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64')))"
```

Expected: file `tests/fixtures/tiny.png` exists (~70 bytes).

- [ ] **Step 2: Write the failing tests**

```ts
// tests/unit/core/image-input.test.ts
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveImageInput } from "../../../src/core/image-input.js";
import { CliError } from "../../../src/framework/errors.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixture = path.resolve(here, "../../fixtures/tiny.png");

describe("resolveImageInput — local path", () => {
  it("reads the file and returns buffer + mime + filename", async () => {
    const res = await resolveImageInput(fixture);
    expect(res.mime).toBe("image/png");
    expect(res.filename).toBe("tiny.png");
    expect(res.buffer.length).toBeGreaterThan(0);
  });

  it("throws INVALID_INPUT when file missing", async () => {
    await expect(resolveImageInput("./nope.png")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("throws INVALID_INPUT for unsupported MIME", async () => {
    // .txt file, clearly not an image
    const tmp = path.resolve(here, "../../fixtures/not-an-image.txt");
    const fs = await import("node:fs");
    fs.writeFileSync(tmp, "hello");
    await expect(resolveImageInput(tmp)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    fs.unlinkSync(tmp);
  });
});

describe("resolveImageInput — URL", () => {
  it("detects http URL and returns fetch-planned descriptor", async () => {
    // We don't actually hit the network in unit tests; instead assert that the
    // function throws in dryRun mode OR short-circuits. For now, verify the
    // function recognizes the URL format by attempting and catching.
    // Concretely: we check that a URL input does NOT throw INVALID_INPUT for
    // "file not found" — it either fetches or throws NETWORK_ERROR.
    try {
      await resolveImageInput("https://invalid.example.invalid/x.png");
      // if it returns, that's ok — we only care it didn't treat it as a missing path
    } catch (e) {
      const err = e as CliError;
      expect(err.code).not.toBe("INVALID_INPUT");
    }
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

Run: `npm test -- tests/unit/core/image-input.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/core/image-input.ts`**

```ts
// src/core/image-input.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import mime from "mime";
import { CliError } from "../framework/errors.js";

export interface ResolvedImage {
  buffer: Buffer;
  filename: string;
  mime: string;
}

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function resolveImageInput(input: string): Promise<ResolvedImage> {
  if (/^https?:\/\//i.test(input)) {
    return await fetchUrl(input);
  }
  return await readLocal(input);
}

async function readLocal(p: string): Promise<ResolvedImage> {
  let stat;
  try {
    stat = await fs.stat(p);
  } catch (err) {
    throw new CliError("INVALID_INPUT", `Image file not found: ${p}`);
  }
  if (!stat.isFile()) {
    throw new CliError("INVALID_INPUT", `Not a regular file: ${p}`);
  }
  const buffer = await fs.readFile(p);
  const filename = path.basename(p);
  const m = mime.getType(p) ?? "application/octet-stream";
  if (!ALLOWED_MIME.has(m)) {
    throw new CliError(
      "INVALID_INPUT",
      `Unsupported image MIME: ${m}. Allowed: png/jpeg/webp`,
    );
  }
  return { buffer, filename, mime: m };
}

async function fetchUrl(url: string): Promise<ResolvedImage> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    throw new CliError("NETWORK_ERROR", `Failed to fetch ${url}: ${e.message ?? e.code}`);
  }
  if (!res.ok) {
    throw new CliError(
      "NETWORK_ERROR",
      `Fetch ${url} returned HTTP ${res.status}`,
    );
  }
  const m = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!ALLOWED_MIME.has(m)) {
    throw new CliError(
      "INVALID_INPUT",
      `Unsupported image MIME from URL: ${m || "(none)"}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const filename = path.basename(new URL(url).pathname) || "download";
  return { buffer: buf, filename, mime: m };
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `npm test -- tests/unit/core/image-input.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/image-input.ts tests/unit/core/image-input.test.ts tests/fixtures/tiny.png
git commit -m "feat(core): resolve image input from local path or http(s) URL"
```

---

## Task 8: Output naming utility

**Files:**
- Create: `src/core/naming.ts`
- Test: `tests/unit/core/naming.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/core/naming.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveOutputPaths, timestamp } from "../../../src/core/naming.js";

describe("timestamp", () => {
  it("produces YYYYMMDD-HHmmss format", () => {
    const ts = timestamp(new Date("2026-04-23T15:30:12"));
    expect(ts).toBe("20260423-153012");
  });
});

describe("resolveOutputPaths", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "naming-test-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("n=1, no --out → cwd with timestamp", () => {
    const paths = resolveOutputPaths({
      out: undefined,
      count: 1,
      ext: "png",
      cwd: dir,
      now: new Date("2026-04-23T15:30:12"),
    });
    expect(paths).toHaveLength(1);
    expect(paths[0]!).toMatch(new RegExp(`^${dir}/gpt-image-20260423-153012(?:-[a-f0-9]{2})?\\.png$`));
  });

  it("n=1, --out is a file path → use it directly", () => {
    const out = path.join(dir, "foo.png");
    const paths = resolveOutputPaths({
      out,
      count: 1,
      ext: "png",
      cwd: dir,
      now: new Date(),
    });
    expect(paths).toEqual([out]);
  });

  it("n=1, --out is existing directory → auto-name in that dir", () => {
    const paths = resolveOutputPaths({
      out: dir,
      count: 1,
      ext: "png",
      cwd: process.cwd(),
      now: new Date("2026-04-23T15:30:12"),
    });
    expect(paths[0]!.startsWith(dir + "/gpt-image-20260423-153012")).toBe(true);
  });

  it("n=3, --out file path → suffix -0, -1, -2", () => {
    const out = path.join(dir, "base.png");
    const paths = resolveOutputPaths({
      out,
      count: 3,
      ext: "png",
      cwd: dir,
      now: new Date(),
    });
    expect(paths).toEqual([
      path.join(dir, "base-0.png"),
      path.join(dir, "base-1.png"),
      path.join(dir, "base-2.png"),
    ]);
  });

  it("n=3, --out dir → timestamped with -0/-1/-2 suffix", () => {
    const paths = resolveOutputPaths({
      out: dir,
      count: 3,
      ext: "png",
      cwd: process.cwd(),
      now: new Date("2026-04-23T15:30:12"),
    });
    expect(paths).toHaveLength(3);
    expect(paths[0]!).toMatch(new RegExp(`${dir}/gpt-image-20260423-153012-0\\.png$`));
    expect(paths[2]!).toMatch(new RegExp(`${dir}/gpt-image-20260423-153012-2\\.png$`));
  });

  it("same-second collision → appends random 2-hex suffix", () => {
    fs.writeFileSync(path.join(dir, "gpt-image-20260423-153012.png"), "x");
    const paths = resolveOutputPaths({
      out: undefined,
      count: 1,
      ext: "png",
      cwd: dir,
      now: new Date("2026-04-23T15:30:12"),
    });
    expect(paths[0]!).toMatch(new RegExp(`${dir}/gpt-image-20260423-153012-[a-f0-9]{2}\\.png$`));
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- tests/unit/core/naming.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/naming.ts`**

```ts
// src/core/naming.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export function timestamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

export interface ResolveOutputInput {
  out?: string;
  count: number;
  ext: string;
  cwd: string;
  now?: Date;
}

export function resolveOutputPaths(i: ResolveOutputInput): string[] {
  const now = i.now ?? new Date();
  const ts = timestamp(now);

  let dir: string;
  let baseStem: string | undefined; // undefined → use auto-name with ts

  if (!i.out) {
    dir = i.cwd;
    baseStem = undefined;
  } else if (isExistingDir(i.out) || i.out.endsWith("/")) {
    dir = i.out;
    baseStem = undefined;
  } else {
    dir = path.dirname(i.out) || ".";
    baseStem = path.basename(i.out, path.extname(i.out));
  }

  const paths: string[] = [];
  for (let idx = 0; idx < i.count; idx++) {
    let name: string;
    if (baseStem !== undefined) {
      name = i.count === 1 ? `${baseStem}.${i.ext}` : `${baseStem}-${idx}.${i.ext}`;
    } else {
      const suffix = i.count === 1 ? "" : `-${idx}`;
      name = `gpt-image-${ts}${suffix}.${i.ext}`;
    }
    let full = path.join(dir, name);
    if (fs.existsSync(full)) {
      // Collision → append random hash
      const hash = crypto.randomBytes(1).toString("hex");
      const stem = path.basename(full, path.extname(full));
      full = path.join(dir, `${stem}-${hash}.${i.ext}`);
    }
    paths.push(full);
  }
  return paths;
}

function isExistingDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- tests/unit/core/naming.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/naming.ts tests/unit/core/naming.test.ts
git commit -m "feat(core): output path resolver with auto-name and collision suffix"
```

---

## Task 9: `config` subcommand

**Files:**
- Create: `src/commands/config.ts`

Not unit-tested directly (Commander wiring + interactive readline are awkward to test cleanly); `core/config.ts` is already covered. Covered end-to-end by manual smoke.

- [ ] **Step 1: Implement `src/commands/config.ts`**

```ts
// src/commands/config.ts
import { Command } from "commander";
import * as readline from "node:readline";
import {
  readConfigFile,
  writeConfigFile,
  configFilePath,
  resolveConfig,
  redactApiKey,
  type ConfigFile,
} from "../core/config.js";
import { CliError } from "../framework/errors.js";
import type { Emitter, OutputEnvelope } from "../framework/types.js";

const ALLOWED_KEYS = new Set(["api_key", "endpoint"]);

export function registerConfig(program: Command, emit: Emitter): void {
  const cfg = program.command("config").description("Manage CLI config");

  cfg
    .command("init")
    .description("Interactive wizard to create config file")
    .action(async () => {
      if (!process.stdin.isTTY) {
        throw new CliError(
          "INVALID_INPUT",
          "config init requires a TTY. Use `config set <key> <value>` instead.",
        );
      }
      const apiKey = await prompt("OpenAI API key (sk-...): ", { mask: true });
      const endpoint = await prompt(
        "Endpoint (leave empty for default https://api.openai.com/v1): ",
      );
      const existing = readConfigFile();
      const next: ConfigFile = { ...existing };
      if (apiKey) next.api_key = apiKey;
      if (endpoint) next.endpoint = endpoint;
      writeConfigFile(next);
      emit({
        ok: true,
        data: {
          path: configFilePath(),
          fields: Object.keys(next).filter((k) => (next as Record<string, unknown>)[k]),
        },
      });
    });

  cfg
    .command("set <key> <value>")
    .description("Set a config key. Keys: api_key, endpoint")
    .action(async (key: string, value: string, _opts, cmd) => {
      if (!ALLOWED_KEYS.has(key)) {
        throw new CliError("INVALID_INPUT", `Unknown key: ${key}. Allowed: api_key, endpoint`);
      }
      const existing = readConfigFile();
      const globalOpts = cmd.optsWithGlobals() as { yes?: boolean };
      if (
        (existing as Record<string, unknown>)[key] &&
        !globalOpts.yes &&
        process.stdin.isTTY
      ) {
        const ans = await prompt(`Overwrite existing ${key}? [y/N]: `);
        if (!/^y/i.test(ans)) {
          throw new CliError("INVALID_INPUT", "aborted");
        }
      }
      const next = { ...existing, [key]: value };
      writeConfigFile(next);
      emit({ ok: true, data: { path: configFilePath(), fields: [key] } });
    });

  cfg
    .command("get <key>")
    .description("Print a config key")
    .action((key: string) => {
      if (!ALLOWED_KEYS.has(key)) {
        throw new CliError("INVALID_INPUT", `Unknown key: ${key}`);
      }
      const file = readConfigFile();
      const val = (file as Record<string, unknown>)[key] ?? null;
      emit({ ok: true, data: { key, value: val } });
    });

  cfg
    .command("show")
    .description("Show effective config (api_key redacted)")
    .action((_opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as { apiKey?: string; endpoint?: string };
      const r = resolveConfig({ apiKey: globalOpts.apiKey, endpoint: globalOpts.endpoint });
      emit({
        ok: true,
        data: {
          api_key: redactApiKey(r.config.apiKey),
          endpoint: r.config.endpoint ?? null,
          sources: r.sources,
        },
      });
    });

  cfg
    .command("path")
    .description("Print config file path")
    .action(() => {
      emit({ ok: true, data: { path: configFilePath() } });
    });
}

function prompt(question: string, opts: { mask?: boolean } = {}): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (opts.mask) {
      // Simple masking: we don't echo; readline will still capture input
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    }
    rl.question(question, (ans) => {
      rl.close();
      if (opts.mask) process.stdout.write("\n");
      resolve(ans.trim());
    });
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/config.ts
git commit -m "feat(cmd): config init/set/get/show/path"
```

---

## Task 10: `generate` subcommand

**Files:**
- Create: `src/commands/generate.ts`
- Test: `tests/integration/generate.test.ts`

- [ ] **Step 1: Write the failing integration test (msw)**

```ts
// tests/integration/generate.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runGenerate } from "../../src/commands/generate.js";
import { Command } from "commander";

// Tiny 1x1 PNG, base64
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const server = setupServer(
  http.post("https://api.openai.com/v1/images/generations", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    expect(body.model).toBe("gpt-image-2");
    return HttpResponse.json({
      created: 1,
      data: [{ b64_json: PNG_1X1 }],
      usage: { input_tokens: 10, output_tokens: 1000, total_tokens: 1010 },
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

describe("generate", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-test-"));
    process.env.OPENAI_API_KEY = "sk-test";
  });

  it("single image is written and envelope emitted", async () => {
    const captured: unknown[] = [];
    await runGenerate(
      {
        prompt: "a cat",
        count: 1,
        size: "1024x1024",
        quality: "auto",
        background: "auto",
        outputFormat: "png",
        out: path.join(dir, "cat.png"),
        stdoutBase64: false,
      },
      {
        endpoint: undefined,
        apiKey: undefined,
        format: "json",
        jq: undefined,
        dryRun: false,
        yes: false,
        verbose: false,
      },
      (env) => captured.push(env),
    );
    expect(fs.existsSync(path.join(dir, "cat.png"))).toBe(true);
    const env = captured[0] as { ok: boolean; data: { paths: string[]; model: string } };
    expect(env.ok).toBe(true);
    expect(env.data.model).toBe("gpt-image-2");
    expect(env.data.paths).toEqual([path.join(dir, "cat.png")]);
  });

  it("dry-run does not call API or write files", async () => {
    const captured: unknown[] = [];
    await runGenerate(
      {
        prompt: "a cat",
        count: 1,
        size: "auto",
        quality: "auto",
        background: "auto",
        outputFormat: "png",
        out: path.join(dir, "cat.png"),
        stdoutBase64: false,
      },
      {
        endpoint: undefined,
        apiKey: undefined,
        format: "json",
        jq: undefined,
        dryRun: true,
        yes: false,
        verbose: false,
      },
      (env) => captured.push(env),
    );
    expect(fs.existsSync(path.join(dir, "cat.png"))).toBe(false);
    const env = captured[0] as { ok: boolean; data: { request: unknown } };
    expect(env.ok).toBe(true);
    expect((env.data as { request: unknown }).request).toBeDefined();
  });

  it("rejects INVALID_INPUT when prompt empty", async () => {
    const captured: unknown[] = [];
    await expect(
      runGenerate(
        {
          prompt: "",
          count: 1,
          size: "auto",
          quality: "auto",
          background: "auto",
          outputFormat: "png",
          stdoutBase64: false,
        },
        {
          endpoint: undefined,
          apiKey: undefined,
          format: "json",
          jq: undefined,
          dryRun: false,
          yes: false,
          verbose: false,
        },
        (env) => captured.push(env),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects INVALID_INPUT for count > 10", async () => {
    await expect(
      runGenerate(
        {
          prompt: "a",
          count: 11,
          size: "auto",
          quality: "auto",
          background: "auto",
          outputFormat: "png",
          stdoutBase64: false,
        },
        {
          endpoint: undefined,
          apiKey: undefined,
          format: "json",
          jq: undefined,
          dryRun: false,
          yes: false,
          verbose: false,
        },
        () => {},
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- tests/integration/generate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/commands/generate.ts`**

```ts
// src/commands/generate.ts
import * as fs from "node:fs";
import { Command } from "commander";
import { makeClient } from "../core/client.js";
import { resolveOutputPaths } from "../core/naming.js";
import { CliError, translateOpenAIError } from "../framework/errors.js";
import type {
  Emitter,
  GlobalOptions,
  OutputEnvelope,
  ImageOpResultData,
} from "../framework/types.js";

export interface GenerateOptions {
  prompt: string;
  count: number;
  size: string;
  quality: string;
  background: string;
  outputFormat: string;
  compression?: number;
  moderation?: string;
  out?: string;
  stdoutBase64: boolean;
}

const SIZE_VALUES = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
const QUALITY_VALUES = new Set(["low", "medium", "high", "auto"]);
const BG_VALUES = new Set(["transparent", "opaque", "auto"]);
const FMT_VALUES = new Set(["png", "jpeg", "webp"]);
const MOD_VALUES = new Set(["auto", "low"]);

export function validateGenerateOptions(opts: GenerateOptions): void {
  if (!opts.prompt || opts.prompt.trim() === "") {
    throw new CliError("INVALID_INPUT", "prompt must be non-empty");
  }
  if (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > 10) {
    throw new CliError("INVALID_INPUT", "count must be an integer in [1,10]");
  }
  if (!SIZE_VALUES.has(opts.size)) {
    throw new CliError("INVALID_INPUT", `size must be one of: ${[...SIZE_VALUES].join(", ")}`);
  }
  if (!QUALITY_VALUES.has(opts.quality)) {
    throw new CliError("INVALID_INPUT", `quality must be one of: ${[...QUALITY_VALUES].join(", ")}`);
  }
  if (!BG_VALUES.has(opts.background)) {
    throw new CliError("INVALID_INPUT", `background must be one of: ${[...BG_VALUES].join(", ")}`);
  }
  if (!FMT_VALUES.has(opts.outputFormat)) {
    throw new CliError("INVALID_INPUT", `output-format must be one of: ${[...FMT_VALUES].join(", ")}`);
  }
  if (opts.moderation && !MOD_VALUES.has(opts.moderation)) {
    throw new CliError("INVALID_INPUT", `moderation must be one of: ${[...MOD_VALUES].join(", ")}`);
  }
  if (opts.compression !== undefined) {
    if (opts.outputFormat === "png") {
      throw new CliError("INVALID_INPUT", "--compression is only valid for jpeg/webp");
    }
    if (opts.compression < 0 || opts.compression > 100 || !Number.isInteger(opts.compression)) {
      throw new CliError("INVALID_INPUT", "compression must be integer in [0,100]");
    }
  }
  if (opts.background === "transparent" && opts.outputFormat === "jpeg") {
    throw new CliError("INVALID_INPUT", "transparent background requires png or webp");
  }
}

export async function runGenerate(
  opts: GenerateOptions,
  global: GlobalOptions,
  emit: Emitter,
): Promise<void> {
  validateGenerateOptions(opts);
  const emitOpts = { toStderr: opts.stdoutBase64 };

  const prompt =
    opts.prompt === "-"
      ? fs.readFileSync(0, "utf8").trim()
      : opts.prompt;
  if (!prompt) throw new CliError("INVALID_INPUT", "prompt from stdin was empty");

  const request: Record<string, unknown> = {
    model: "gpt-image-2",
    prompt,
    n: opts.count,
    size: opts.size,
    quality: opts.quality,
    background: opts.background,
    output_format: opts.outputFormat,
  };
  if (opts.compression !== undefined) request.output_compression = opts.compression;
  if (opts.moderation) request.moderation = opts.moderation;

  if (global.dryRun) {
    emit(
      {
        ok: true,
        data: { operation: "generate", request },
      },
      emitOpts,
    );
    return;
  }

  const client = makeClient({ apiKey: global.apiKey, endpoint: global.endpoint });

  let response;
  try {
    response = await client.images.generate(request as Parameters<typeof client.images.generate>[0]);
  } catch (err) {
    throw translateOpenAIError(err);
  }

  const items = (response.data ?? []) as Array<{ b64_json?: string }>;
  if (items.length === 0) {
    throw new CliError("OPENAI_API_ERROR", "response contained no images");
  }

  const paths = resolveOutputPaths({
    out: opts.out,
    count: items.length,
    ext: opts.outputFormat,
    cwd: process.cwd(),
  });

  for (let i = 0; i < items.length; i++) {
    const b64 = items[i]!.b64_json;
    if (!b64) throw new CliError("OPENAI_API_ERROR", `item ${i} has no b64_json`);
    const outPath = paths[i]!;
    ensureParentDir(outPath);
    try {
      fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
    } catch (err) {
      const e = err as { message?: string };
      throw new CliError("IO_ERROR", `failed to write ${outPath}: ${e.message}`);
    }
    if (opts.stdoutBase64) process.stdout.write(b64 + "\n");
  }

  const data: ImageOpResultData = {
    model: "gpt-image-2",
    operation: "generate",
    paths,
    size: opts.size,
    quality: opts.quality,
    output_format: opts.outputFormat,
    count: items.length,
    usage: (response as unknown as { usage?: ImageOpResultData["usage"] }).usage,
  };
  emit({ ok: true, data }, emitOpts);
}

function ensureParentDir(p: string): void {
  const dir = p.substring(0, p.lastIndexOf("/"));
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function registerGenerate(
  program: Command,
  emit: Emitter,
): void {
  program
    .command("generate")
    .description("Generate image(s) from a prompt")
    .requiredOption("-p, --prompt <text>", "prompt (use '-' to read stdin)")
    .option("-n, --count <int>", "number of images (1-10)", (v) => parseInt(v, 10), 1)
    .option("-s, --size <wxh>", "image size", "auto")
    .option("-q, --quality <level>", "quality: low/medium/high/auto", "auto")
    .option("-b, --background <mode>", "background: transparent/opaque/auto", "auto")
    .option("-f, --output-format <fmt>", "output format: png/jpeg/webp", "png")
    .option("--compression <int>", "jpeg/webp compression 0-100", (v) => parseInt(v, 10))
    .option("--moderation <level>", "moderation: auto/low")
    .option("--out <path>", "output file or directory")
    .option("--stdout-base64", "print base64 to stdout (envelope goes to stderr)", false)
    .action(async (opts: GenerateOptions, cmd: Command) => {
      const global = cmd.optsWithGlobals() as unknown as GlobalOptions;
      await runGenerate(opts, global, emit);
    });
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- tests/integration/generate.test.ts`
Expected: all PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/commands/generate.ts tests/integration/generate.test.ts
git commit -m "feat(cmd): generate subcommand with validation, dry-run, file write"
```

---

## Task 11: `edit` subcommand

**Files:**
- Create: `src/commands/edit.ts`
- Test: `tests/integration/edit.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/edit.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runEdit } from "../../src/commands/edit.js";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const server = setupServer(
  http.post("https://api.openai.com/v1/images/edits", async ({ request }) => {
    // Edit endpoint uses multipart/form-data
    const ct = request.headers.get("content-type") ?? "";
    expect(ct).toContain("multipart/form-data");
    return HttpResponse.json({
      created: 1,
      data: [{ b64_json: PNG_1X1 }],
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

describe("edit", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "edit-test-"));
    process.env.OPENAI_API_KEY = "sk-test";
    // copy fixture to dir
    const here = fileURLToPath(new URL(".", import.meta.url));
    const src = path.resolve(here, "../fixtures/tiny.png");
    fs.copyFileSync(src, path.join(dir, "base.png"));
  });

  it("edits a single image and writes output", async () => {
    const captured: unknown[] = [];
    await runEdit(
      {
        prompt: "add a hat",
        images: [path.join(dir, "base.png")],
        mask: undefined,
        inputFidelity: "low",
        count: 1,
        size: "auto",
        quality: "auto",
        background: "auto",
        outputFormat: "png",
        out: path.join(dir, "out.png"),
        stdoutBase64: false,
      },
      {
        endpoint: undefined,
        apiKey: undefined,
        format: "json",
        jq: undefined,
        dryRun: false,
        yes: false,
        verbose: false,
      },
      (env) => captured.push(env),
    );
    expect(fs.existsSync(path.join(dir, "out.png"))).toBe(true);
    const env = captured[0] as { ok: boolean; data: { operation: string } };
    expect(env.data.operation).toBe("edit");
  });

  it("rejects when --image missing", async () => {
    await expect(
      runEdit(
        {
          prompt: "x",
          images: [],
          mask: undefined,
          inputFidelity: "low",
          count: 1,
          size: "auto",
          quality: "auto",
          background: "auto",
          outputFormat: "png",
          stdoutBase64: false,
        },
        {
          endpoint: undefined,
          apiKey: undefined,
          format: "json",
          jq: undefined,
          dryRun: false,
          yes: false,
          verbose: false,
        },
        () => {},
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- tests/integration/edit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/commands/edit.ts`**

```ts
// src/commands/edit.ts
import * as fs from "node:fs";
import { Command } from "commander";
import { toFile } from "openai";
import { makeClient } from "../core/client.js";
import { resolveImageInput } from "../core/image-input.js";
import { resolveOutputPaths } from "../core/naming.js";
import { CliError, translateOpenAIError } from "../framework/errors.js";
import type {
  Emitter,
  GlobalOptions,
  OutputEnvelope,
  ImageOpResultData,
} from "../framework/types.js";
import { validateGenerateOptions } from "./generate.js";

export interface EditOptions {
  prompt: string;
  images: string[];
  mask?: string;
  inputFidelity: string;
  count: number;
  size: string;
  quality: string;
  background: string;
  outputFormat: string;
  compression?: number;
  moderation?: string;
  out?: string;
  stdoutBase64: boolean;
}

const FIDELITY_VALUES = new Set(["low", "high"]);

function validateEditOptions(opts: EditOptions): void {
  validateGenerateOptions({
    prompt: opts.prompt,
    count: opts.count,
    size: opts.size,
    quality: opts.quality,
    background: opts.background,
    outputFormat: opts.outputFormat,
    compression: opts.compression,
    moderation: opts.moderation,
    stdoutBase64: opts.stdoutBase64,
    out: opts.out,
  });
  if (!opts.images || opts.images.length === 0) {
    throw new CliError("INVALID_INPUT", "--image is required (at least one)");
  }
  if (!FIDELITY_VALUES.has(opts.inputFidelity)) {
    throw new CliError(
      "INVALID_INPUT",
      `input-fidelity must be one of: ${[...FIDELITY_VALUES].join(", ")}`,
    );
  }
}

export async function runEdit(
  opts: EditOptions,
  global: GlobalOptions,
  emit: Emitter,
): Promise<void> {
  validateEditOptions(opts);
  const emitOpts = { toStderr: opts.stdoutBase64 };

  const prompt =
    opts.prompt === "-" ? fs.readFileSync(0, "utf8").trim() : opts.prompt;
  if (!prompt) throw new CliError("INVALID_INPUT", "prompt from stdin was empty");

  const imageFiles = await Promise.all(
    opts.images.map(async (p) => {
      const r = await resolveImageInput(p);
      return await toFile(r.buffer, r.filename, { type: r.mime });
    }),
  );
  const maskFile = opts.mask
    ? await (async () => {
        const r = await resolveImageInput(opts.mask!);
        return await toFile(r.buffer, r.filename, { type: r.mime });
      })()
    : undefined;

  const request: Record<string, unknown> = {
    model: "gpt-image-2",
    prompt,
    image: imageFiles.length === 1 ? imageFiles[0]! : imageFiles,
    n: opts.count,
    size: opts.size,
    quality: opts.quality,
    background: opts.background,
    output_format: opts.outputFormat,
    input_fidelity: opts.inputFidelity,
  };
  if (maskFile) request.mask = maskFile;
  if (opts.compression !== undefined) request.output_compression = opts.compression;
  if (opts.moderation) request.moderation = opts.moderation;

  if (global.dryRun) {
    emit(
      {
        ok: true,
        data: {
          operation: "edit",
          request: {
            ...request,
            image: `<${imageFiles.length} file(s)>`,
            mask: maskFile ? "<file>" : undefined,
          },
        },
      },
      emitOpts,
    );
    return;
  }

  const client = makeClient({ apiKey: global.apiKey, endpoint: global.endpoint });

  let response;
  try {
    response = await client.images.edit(request as Parameters<typeof client.images.edit>[0]);
  } catch (err) {
    throw translateOpenAIError(err);
  }

  const items = (response.data ?? []) as Array<{ b64_json?: string }>;
  if (items.length === 0) throw new CliError("OPENAI_API_ERROR", "no images returned");

  const paths = resolveOutputPaths({
    out: opts.out,
    count: items.length,
    ext: opts.outputFormat,
    cwd: process.cwd(),
  });

  for (let i = 0; i < items.length; i++) {
    const b64 = items[i]!.b64_json;
    if (!b64) throw new CliError("OPENAI_API_ERROR", `item ${i} has no b64_json`);
    try {
      fs.writeFileSync(paths[i]!, Buffer.from(b64, "base64"));
    } catch (err) {
      const e = err as { message?: string };
      throw new CliError("IO_ERROR", `failed to write ${paths[i]}: ${e.message}`);
    }
    if (opts.stdoutBase64) process.stdout.write(b64 + "\n");
  }

  const data: ImageOpResultData = {
    model: "gpt-image-2",
    operation: "edit",
    paths,
    size: opts.size,
    quality: opts.quality,
    output_format: opts.outputFormat,
    count: items.length,
    usage: (response as unknown as { usage?: ImageOpResultData["usage"] }).usage,
  };
  emit({ ok: true, data }, emitOpts);
}

export function registerEdit(
  program: Command,
  emit: Emitter,
): void {
  program
    .command("edit")
    .description("Edit image(s) with a prompt and optional mask")
    .requiredOption("-p, --prompt <text>", "prompt (use '-' to read stdin)")
    .requiredOption(
      "--image <path|url>",
      "input image (repeat for multi-image input)",
      (val: string, prev: string[] = []) => [...prev, val],
      [],
    )
    .option("--mask <path|url>", "optional inpainting mask")
    .option("--input-fidelity <level>", "low | high", "low")
    .option("-n, --count <int>", "number of outputs (1-10)", (v) => parseInt(v, 10), 1)
    .option("-s, --size <wxh>", "image size", "auto")
    .option("-q, --quality <level>", "quality", "auto")
    .option("-b, --background <mode>", "background", "auto")
    .option("-f, --output-format <fmt>", "output format", "png")
    .option("--compression <int>", "jpeg/webp compression 0-100", (v) => parseInt(v, 10))
    .option("--moderation <level>", "auto | low")
    .option("--out <path>", "output file or directory")
    .option("--stdout-base64", "print base64 to stdout", false)
    .action(async (raw: Record<string, unknown>, cmd: Command) => {
      const opts: EditOptions = {
        prompt: raw.prompt as string,
        images: (raw.image as string[]) ?? [],
        mask: raw.mask as string | undefined,
        inputFidelity: (raw.inputFidelity as string) ?? "low",
        count: raw.count as number,
        size: raw.size as string,
        quality: raw.quality as string,
        background: raw.background as string,
        outputFormat: raw.outputFormat as string,
        compression: raw.compression as number | undefined,
        moderation: raw.moderation as string | undefined,
        out: raw.out as string | undefined,
        stdoutBase64: Boolean(raw.stdoutBase64),
      };
      const global = cmd.optsWithGlobals() as unknown as GlobalOptions;
      await runEdit(opts, global, emit);
    });
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- tests/integration/edit.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/edit.ts tests/integration/edit.test.ts
git commit -m "feat(cmd): edit subcommand with --image/--mask/--input-fidelity"
```

---

## Task 12: Wire program in `src/index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace stub with full wiring**

```ts
// src/index.ts
import { Command } from "commander";
import { applyJq, renderEnvelope } from "./framework/output.js";
import { CliError, exitCodeFor, translateOpenAIError } from "./framework/errors.js";
import type {
  Emitter,
  EmitOptions,
  GlobalOptions,
  OutputEnvelope,
} from "./framework/types.js";
import { registerGenerate } from "./commands/generate.js";
import { registerEdit } from "./commands/edit.js";
import { registerConfig } from "./commands/config.js";

const VERSION = "1.0.0";

function makeEmitter(program: Command): Emitter {
  return (env: OutputEnvelope, opts?: EmitOptions) => {
    const g = program.opts() as GlobalOptions;
    const shaped = env.ok && g.jq ? { ok: true as const, data: applyJq(env, g.jq) } : env;
    const text = renderEnvelope(shaped as OutputEnvelope, { format: g.format });
    const target = opts?.toStderr ? process.stderr : process.stdout;
    target.write(text + "\n");
  };
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("gpt-image-cli")
    .version(VERSION)
    .description("OpenAI gpt-image-2 generation and editing CLI")
    .option("--endpoint <url>", "override OpenAI base URL")
    .option("--api-key <key>", "override OpenAI API key")
    .option("--format <format>", "output format: json | table", "json")
    .option("--jq <expr>", "jq-like path filter on envelope")
    .option("--dry-run", "print request without calling API", false)
    .option("--yes", "skip confirmation for overwriting config values", false)
    .option("--verbose", "debug info on stderr", false);

  const emit = makeEmitter(program);

  registerGenerate(program, emit);
  registerEdit(program, emit);
  registerConfig(program, emit);

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const cli = err instanceof CliError ? err : translateOpenAIError(err);
    const env = cli.toEnvelope();
    const g = program.opts() as GlobalOptions;
    const text = renderEnvelope(env, { format: g.format ?? "json" });
    process.stderr.write(text + "\n");
    if (g.verbose && err instanceof Error && err.stack) {
      process.stderr.write(err.stack + "\n");
    }
    process.exit(exitCodeFor(cli.code));
  }
}

main();
```

- [ ] **Step 2: Build and smoke-test help / version**

Run:
```bash
npm run build
node dist/index.js --version
node dist/index.js --help
node dist/index.js generate --help
node dist/index.js edit --help
node dist/index.js config --help
```

Expected: no errors, help output shows three subcommands plus flags described above.

- [ ] **Step 3: Smoke-test error path (no API key)**

Run: `OPENAI_API_KEY= node dist/index.js generate -p "test" --dry-run`
Expected: prints dry-run envelope (no key needed for dry-run, since no API call).

Run: `OPENAI_API_KEY= node dist/index.js generate -p "test"`
Expected: exits with code 2, stderr shows `CONFIG_MISSING` envelope.

Confirm: `echo $?` → `2`.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire Commander program with global flags and error sink"
```

---

## Task 13: Full test sweep + lint

**Files:** none (verification only)

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: all unit + integration tests PASS.

- [ ] **Step 2: Run lint/typecheck**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Full build**

Run: `npm run build`
Expected: `dist/index.js` exists, no errors.

- [ ] **Step 4: If any step fails, fix and re-run. Do not commit test fixes without the fix.**

---

## Task 14: Write `skills/gpt-image/SKILL.md`

**Files:**
- Create: `skills/gpt-image/SKILL.md`

- [ ] **Step 1: Write the SKILL file**

```markdown
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
   不可执行则提示用户 `npm i -g gpt-image-cli`(若已发布)或在仓库中 `npm link`。
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
配 `--jq '.data.paths[0]'` 直接拿到第一张路径。

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
```

- [ ] **Step 2: Commit**

```bash
git add skills/gpt-image/SKILL.md
git commit -m "docs(skill): add gpt-image SKILL.md"
```

---

## Task 15: README and smoke script

**Files:**
- Create: `README.md`
- Create: `scripts/smoke.sh`

- [ ] **Step 1: Write `README.md`**

```markdown
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
```

- [ ] **Step 2: Write `scripts/smoke.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
# Real-API smoke test. Requires OPENAI_API_KEY in env.
# Usage: scripts/smoke.sh

: "${OPENAI_API_KEY:?OPENAI_API_KEY required}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "== generate =="
gpt-image-cli generate -p "a small blue circle on white" -s 1024x1024 -q low --out "$TMP/gen.png"
test -s "$TMP/gen.png" && echo "OK: gen.png written ($(wc -c < "$TMP/gen.png") bytes)"

echo "== edit =="
gpt-image-cli edit --image "$TMP/gen.png" -p "make the circle red" --out "$TMP/edit.png"
test -s "$TMP/edit.png" && echo "OK: edit.png written ($(wc -c < "$TMP/edit.png") bytes)"

echo "All smoke checks passed."
```

Then `chmod +x scripts/smoke.sh`.

- [ ] **Step 3: Final build + test sweep**

Run: `npm run lint && npm test && npm run build`
Expected: clean green.

- [ ] **Step 4: Commit**

```bash
git add README.md scripts/smoke.sh
git commit -m "docs: README and real-API smoke script"
```

---

## Task 16: Final verification

**Files:** none

- [ ] **Step 1: Link and exercise the binary globally**

```bash
npm link
gpt-image-cli --version        # → 1.0.0
gpt-image-cli --help           # → shows generate / edit / config
gpt-image-cli config path      # → prints ~/.gpt-image-cli/config.json
gpt-image-cli generate -p "hi" --dry-run
```

Expected: all succeed; dry-run prints `{ ok: true, data: { operation: "generate", request: { model: "gpt-image-2", prompt: "hi", ... } } }`.

- [ ] **Step 2: Verify SKILL discoverable**

Run: `ls skills/gpt-image/SKILL.md && head -10 skills/gpt-image/SKILL.md`
Expected: frontmatter with `name: gpt-image` prints.

- [ ] **Step 3: Optional — run real-API smoke if you have a key**

Run: `OPENAI_API_KEY=sk-... scripts/smoke.sh`
Expected: both `gen.png` and `edit.png` written to a temp dir.

Note: this actually calls OpenAI and spends a small amount. Skip if unavailable.

- [ ] **Step 4: Final commit (if anything changed)**

```bash
git status
# If nothing uncommitted: done.
```

---

## Summary

Total: 16 tasks.

Rough flow:
- T1: scaffold (single commit)
- T2–T4: framework layer (types, output, errors)
- T5–T8: core layer (config, client, image-input, naming)
- T9: config subcommand
- T10–T11: generate + edit subcommands (integration tests via msw)
- T12: program wiring
- T13: test sweep
- T14: SKILL.md
- T15: README + smoke
- T16: final verification
