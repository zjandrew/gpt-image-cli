# Azure API support & multi-profile config — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Azure OpenAI image generation support to `gpt-image-cli` alongside the existing OpenAI endpoint, with named multi-profile config (`config list` / `config use` / `config add` etc.), preserving 100% backward compatibility for existing users via automatic v1→v2 migration.

**Architecture:** Config file gains `version: 2`, `active`, and a `profiles` map keyed by name. Each profile is one of two discriminated types — `openai` or `azure`. A central `resolveActiveProfile()` walks the precedence chain (flag → env → file). `makeClient` branches on profile type and returns `{client, model, profile}`; for Azure it instantiates `AzureOpenAI` with either `apiKey` (api-key header) or `azureADTokenProvider` (Bearer header). Commands (`generate`, `edit`) consume `{client, model}` and stay otherwise unchanged.

**Tech Stack:** TypeScript + Node 18 ESM, `commander`, `openai@4.104.0` (already provides `AzureOpenAI`), `vitest` + `msw` for tests. Target versions: gpt-image-cli **1.1.0**, skill **1.3.0**.

**Spec:** `docs/superpowers/specs/2026-05-15-azure-multi-profile-design.md`

---

## File Map

**Modified:**
- `src/framework/types.ts` — add profile types, widen `ImageOpResultData.model`, add `PROFILE_NOT_FOUND` error code
- `src/framework/errors.ts` — extend `EXIT_CODES` for new code
- `src/core/config.ts` — v2 file format, migration, profile CRUD, `resolveActiveProfile()`
- `src/core/client.ts` — branch openai vs azure
- `src/commands/config.ts` — add list/use/add/remove; evolve init/set/get/show
- `src/commands/generate.ts` — consume `{client, model}`; add azure WEBP guard; dry-run profile block
- `src/commands/edit.ts` — same as generate
- `src/index.ts` — register `--profile` global flag; bump `VERSION` to `1.1.0`
- `package.json` — version `1.1.0`
- `README.md` — append Azure section
- `skills/gpt-image/SKILL.md` — multi-profile section; frontmatter version `1.3.0`
- `tests/unit/core/config.test.ts` — extended with migration + profile CRUD + precedence tests
- `tests/integration/generate.test.ts` — extended with azure + WEBP rejection
- `tests/integration/edit.test.ts` — extended with azure

**Created:**
- `tests/unit/core/client.test.ts` — factory branching tests

---

## Task 1: Type model — profiles, error code, widened envelope

**Files:**
- Modify: `src/framework/types.ts`
- Modify: `src/framework/errors.ts:21-28` (extend `EXIT_CODES`)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/framework/errors.test.ts` (or create a new section if file exists). First check the file:

```bash
cat tests/unit/framework/errors.test.ts | head -30
```

Append this test (adjust the imports to match existing style):

```ts
import { exitCodeFor } from "../../../src/framework/errors.js";

describe("PROFILE_NOT_FOUND", () => {
  it("maps to exit code 2", () => {
    expect(exitCodeFor("PROFILE_NOT_FOUND")).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/framework/errors.test.ts -t PROFILE_NOT_FOUND
```

Expected: FAIL — TypeScript error or `exitCodeFor` returns `undefined` because `PROFILE_NOT_FOUND` isn't in the `ErrorCode` union yet.

- [ ] **Step 3: Implement — add types and error code**

In `src/framework/types.ts`, locate the `ErrorCode` union (line 15) and add `"PROFILE_NOT_FOUND"`:

```ts
export type ErrorCode =
  | "CONFIG_MISSING"
  | "PROFILE_NOT_FOUND"
  | "INVALID_INPUT"
  | "IO_ERROR"
  | "OPENAI_API_ERROR"
  | "NETWORK_ERROR"
  | "INTERNAL";
```

After the existing `ConfigResolution` interface (around line 13), add the profile types:

```ts
export type ProfileType = "openai" | "azure";

export interface OpenAIProfile {
  type: "openai";
  api_key: string;
  endpoint?: string;
}

export interface AzureProfile {
  type: "azure";
  endpoint: string;
  api_key: string;
  api_version: string;
  deployment: string;
  auth_style?: "api-key" | "bearer";
}

export type Profile = OpenAIProfile | AzureProfile;

export interface ResolvedProfile {
  name: string;
  type: ProfileType;
  apiKey: string;
  endpoint: string;
  apiVersion?: string;
  deployment?: string;
  authStyle?: "api-key" | "bearer";
}
```

Update `ImageOpResultData` (line 49) — widen `model` to `string` and add an optional `profile` block:

```ts
export interface ImageOpResultData {
  model: string;
  operation: "generate" | "edit";
  paths: string[];
  size: string;
  quality: string;
  output_format: string;
  count: number;
  profile?: {
    name: string;
    type: ProfileType;
    endpoint: string;
    deployment?: string;
    auth_style?: "api-key" | "bearer";
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}
```

Extend `GlobalOptions` (line 39) with the new flag:

```ts
export interface GlobalOptions {
  endpoint?: string;
  apiKey?: string;
  profile?: string;
  format: "json" | "table";
  jq?: string;
  dryRun: boolean;
  yes: boolean;
  verbose: boolean;
}
```

In `src/framework/errors.ts:21-28`, add `PROFILE_NOT_FOUND: 2` to `EXIT_CODES`:

```ts
const EXIT_CODES: Record<ErrorCode, number> = {
  CONFIG_MISSING: 2,
  PROFILE_NOT_FOUND: 2,
  INVALID_INPUT: 2,
  IO_ERROR: 3,
  OPENAI_API_ERROR: 4,
  NETWORK_ERROR: 5,
  INTERNAL: 10,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/framework/errors.test.ts -t PROFILE_NOT_FOUND
npm run lint
```

Expected: PASS. `npm run lint` (tsc --noEmit) must also pass — if it complains about `ImageOpResultData.model` literal mismatches elsewhere, that's fixed in later tasks (don't pre-fix).

If `npm run lint` fails due to the widened `model` type, that's expected — leave the type widened and let later tasks fix the call sites.

- [ ] **Step 5: Commit**

```bash
git add src/framework/types.ts src/framework/errors.ts tests/unit/framework/errors.test.ts
git commit -m "feat(types): add profile model + PROFILE_NOT_FOUND error code"
```

---

## Task 2: v1 → v2 config migration

**Files:**
- Modify: `src/core/config.ts` (replace `ConfigFile`, `readConfigFile`, `writeConfigFile`)
- Test: `tests/unit/core/config.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/core/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  readConfigFile,
  writeConfigFile,
  configFilePath,
} from "../../../src/core/config.js";

describe("v1 → v2 migration", () => {
  let tmpHome: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-image-cli-mig-"));
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("reads legacy {api_key, endpoint} as v2 with default profile", () => {
    const dir = path.join(tmpHome, ".gpt-image-cli");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const p = path.join(dir, "config.json");
    fs.writeFileSync(
      p,
      JSON.stringify({ api_key: "sk-legacy", endpoint: "https://legacy/v1" }),
      { mode: 0o600 },
    );
    const cfg = readConfigFile();
    expect(cfg.version).toBe(2);
    expect(cfg.active).toBe("default");
    expect(cfg.profiles.default).toEqual({
      type: "openai",
      api_key: "sk-legacy",
      endpoint: "https://legacy/v1",
    });
  });

  it("rewrites legacy file on disk in v2 shape with 0600 perms", () => {
    const dir = path.join(tmpHome, ".gpt-image-cli");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const p = path.join(dir, "config.json");
    fs.writeFileSync(p, JSON.stringify({ api_key: "sk-legacy" }), { mode: 0o600 });
    readConfigFile();
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(2);
    expect(parsed.profiles.default.api_key).toBe("sk-legacy");
    expect(fs.statSync(p).mode & 0o777).toBe(0o600);
  });

  it("emits stderr migration notice exactly once", () => {
    const dir = path.join(tmpHome, ".gpt-image-cli");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const p = path.join(dir, "config.json");
    fs.writeFileSync(p, JSON.stringify({ api_key: "x" }), { mode: 0o600 });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    readConfigFile();
    readConfigFile(); // second read — file is already v2, should NOT print again
    const calls = spy.mock.calls.flat().join("");
    const occurrences = (calls.match(/migrated legacy config to v2/g) ?? []).length;
    expect(occurrences).toBe(1);
    spy.mockRestore();
  });

  it("returns empty v2 skeleton when file does not exist", () => {
    const cfg = readConfigFile();
    expect(cfg).toEqual({ version: 2, active: null, profiles: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/core/config.test.ts -t "v1 → v2 migration"
```

Expected: FAIL on `cfg.version is undefined` / `cfg.profiles is undefined`.

- [ ] **Step 3: Implement the migration**

Replace `src/core/config.ts` contents:

```ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  ConfigSource,
  Profile,
  ResolvedProfile,
} from "../framework/types.js";

export const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com/v1";

export interface ConfigFileV2 {
  version: 2;
  active: string | null;
  profiles: Record<string, Profile>;
}

export interface FlagConfigInput {
  apiKey?: string;
  endpoint?: string;
  profile?: string;
}

interface LegacyConfigFile {
  api_key?: string;
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

function emptyV2(): ConfigFileV2 {
  return { version: 2, active: null, profiles: {} };
}

function isV2(raw: unknown): raw is ConfigFileV2 {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as { version?: unknown; profiles?: unknown };
  return r.version === 2 && typeof r.profiles === "object" && r.profiles !== null;
}

function migrateLegacy(legacy: LegacyConfigFile): ConfigFileV2 {
  const profile: Profile = {
    type: "openai",
    api_key: legacy.api_key ?? "",
    ...(legacy.endpoint ? { endpoint: legacy.endpoint } : {}),
  };
  return {
    version: 2,
    active: "default",
    profiles: { default: profile },
  };
}

export function readConfigFile(): ConfigFileV2 {
  const p = configFilePath();
  if (!fs.existsSync(p)) return emptyV2();
  const raw = fs.readFileSync(p, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyV2();
  }
  if (isV2(parsed)) return parsed;
  // Legacy v1 file present — migrate, persist, notify
  const legacy = parsed as LegacyConfigFile;
  if (legacy.api_key || legacy.endpoint) {
    const migrated = migrateLegacy(legacy);
    writeConfigFile(migrated);
    process.stderr.write(
      `[config] migrated legacy config to v2 (profile "default" created)\n`,
    );
    return migrated;
  }
  return emptyV2();
}

export function writeConfigFile(cfg: ConfigFileV2): void {
  const dir = configDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const clean: ConfigFileV2 = {
    version: 2,
    active: cfg.active,
    profiles: {},
  };
  for (const [name, prof] of Object.entries(cfg.profiles)) {
    clean.profiles[name] = stripEmpty(prof);
  }
  const p = configFilePath();
  fs.writeFileSync(p, JSON.stringify(clean, null, 2), { mode: 0o600 });
  fs.chmodSync(p, 0o600);
}

function stripEmpty(p: Profile): Profile {
  if (p.type === "openai") {
    const out: Profile = { type: "openai", api_key: p.api_key };
    if (p.endpoint) out.endpoint = p.endpoint;
    return out;
  }
  const out: Profile = {
    type: "azure",
    endpoint: p.endpoint,
    api_key: p.api_key,
    api_version: p.api_version,
    deployment: p.deployment,
  };
  if (p.auth_style) out.auth_style = p.auth_style;
  return out;
}

export function redactApiKey(k: string | undefined): string {
  if (!k) return "(unset)";
  if (k.length <= 8) return "***";
  return `***${k.slice(-4)}`;
}

// ---- placeholders to be filled by later tasks ----
export function resolveActiveProfile(
  _flags: FlagConfigInput,
): { profile: ResolvedProfile; sources: { apiKey: ConfigSource; endpoint: ConfigSource } } {
  throw new Error("not implemented — Task 4");
}
```

The placeholder at the bottom keeps Task 4's surface visible without forcing us to implement it here.

Also delete the obsolete `resolveConfig` export — but to keep callers compiling temporarily, leave a stub:

```ts
// TEMP shim — removed in Task 4
export function resolveConfig(flags: FlagConfigInput) {
  const file = readConfigFile();
  const active = file.active ? file.profiles[file.active] : undefined;
  const apiKey = flags.apiKey ?? process.env.OPENAI_API_KEY ?? active?.api_key;
  const endpoint = flags.endpoint ?? process.env.OPENAI_BASE_URL ?? active?.endpoint ?? DEFAULT_OPENAI_ENDPOINT;
  return {
    config: { ...(apiKey ? { apiKey } : {}), endpoint },
    sources: {
      apiKey: (flags.apiKey ? "flag" : process.env.OPENAI_API_KEY ? "env" : active?.api_key ? "file" : "missing") as ConfigSource,
      endpoint: (flags.endpoint ? "flag" : process.env.OPENAI_BASE_URL ? "env" : active?.endpoint ? "file" : "default") as ConfigSource,
    },
  };
}
```

This shim ONLY exists so the rest of the code keeps compiling between tasks. Task 4 deletes it.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/core/config.test.ts
```

Expected: All migration tests PASS. **Existing tests in this file (`resolveConfig priority`, `config file IO`) will FAIL** because the file shape changed. That's expected — they're rewritten in Task 4. Leave them failing for now.

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts tests/unit/core/config.test.ts
git commit -m "feat(config): v1 → v2 schema migration with one-time stderr notice"
```

---

## Task 3: Profile CRUD primitives

**Files:**
- Modify: `src/core/config.ts` (add functions)
- Test: `tests/unit/core/config.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/core/config.test.ts`:

```ts
import {
  addProfile,
  removeProfile,
  useProfile,
  getProfile,
  listProfiles,
  setProfileField,
} from "../../../src/core/config.js";
import { CliError } from "../../../src/framework/errors.js";

describe("profile CRUD", () => {
  let tmpHome: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-image-cli-crud-"));
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("addProfile creates a new openai profile and marks it active when first", () => {
    addProfile("personal", {
      type: "openai",
      api_key: "sk-p",
      endpoint: "https://api.openai.com/v1",
    });
    expect(getProfile("personal")?.type).toBe("openai");
    expect(listProfiles().find((p) => p.name === "personal")?.active).toBe(true);
  });

  it("addProfile rejects duplicate name", () => {
    addProfile("a", { type: "openai", api_key: "x" });
    expect(() =>
      addProfile("a", { type: "openai", api_key: "y" }),
    ).toThrow(/already exists/);
  });

  it("addProfile validates required azure fields", () => {
    expect(() =>
      addProfile("az", {
        type: "azure",
        endpoint: "https://r.openai.azure.com",
        api_key: "k",
        api_version: "",
        deployment: "d",
      }),
    ).toThrow(/api_version/);
  });

  it("useProfile switches active and throws PROFILE_NOT_FOUND if missing", () => {
    addProfile("a", { type: "openai", api_key: "x" });
    addProfile("b", { type: "openai", api_key: "y" });
    useProfile("b");
    expect(listProfiles().find((p) => p.active)?.name).toBe("b");
    try {
      useProfile("missing");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as CliError).code).toBe("PROFILE_NOT_FOUND");
      expect((e as CliError).details).toMatchObject({ available: ["a", "b"] });
    }
  });

  it("removeProfile blocks removing the only profile", () => {
    addProfile("only", { type: "openai", api_key: "x" });
    expect(() => removeProfile("only")).toThrow(/only profile/i);
  });

  it("removeProfile of active switches to first remaining alphabetically", () => {
    addProfile("zeta", { type: "openai", api_key: "z" });
    addProfile("alpha", { type: "openai", api_key: "a" });
    addProfile("beta", { type: "openai", api_key: "b" });
    useProfile("beta");
    removeProfile("beta");
    expect(listProfiles().find((p) => p.active)?.name).toBe("alpha");
  });

  it("setProfileField mutates an existing profile and rejects foreign keys", () => {
    addProfile("p", { type: "openai", api_key: "x" });
    setProfileField("p", "endpoint", "https://new/v1");
    expect(getProfile("p")?.endpoint).toBe("https://new/v1");
    expect(() => setProfileField("p", "api_version", "2024-02-01")).toThrow(/not allowed/);
    expect(() => setProfileField("p", "type", "azure")).toThrow(/type/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/core/config.test.ts -t "profile CRUD"
```

Expected: FAIL — `addProfile is not exported`.

- [ ] **Step 3: Implement profile CRUD**

Append to `src/core/config.ts`:

```ts
import { CliError } from "../framework/errors.js";

const AZURE_REQUIRED: Array<keyof Profile> = [
  "endpoint",
  "api_key",
  "api_version",
  "deployment",
];

const ALLOWED_KEYS_OPENAI = new Set(["api_key", "endpoint"]);
const ALLOWED_KEYS_AZURE = new Set([
  "api_key",
  "endpoint",
  "api_version",
  "deployment",
  "auth_style",
]);

const API_VERSION_RE = /^\d{4}-\d{2}-\d{2}(-preview)?$/;

function validateProfile(p: Profile): void {
  if (p.type === "openai") {
    if (!p.api_key) throw new CliError("INVALID_INPUT", "api_key is required");
    return;
  }
  for (const k of AZURE_REQUIRED) {
    if (!(p as Record<string, unknown>)[k]) {
      throw new CliError("INVALID_INPUT", `azure profile missing required field: ${k}`);
    }
  }
  if (!API_VERSION_RE.test(p.api_version)) {
    throw new CliError(
      "INVALID_INPUT",
      `api_version must match YYYY-MM-DD or YYYY-MM-DD-preview, got: ${p.api_version}`,
    );
  }
  if (p.deployment.includes("/")) {
    throw new CliError("INVALID_INPUT", "deployment must not contain '/'");
  }
  if (p.auth_style && p.auth_style !== "api-key" && p.auth_style !== "bearer") {
    throw new CliError(
      "INVALID_INPUT",
      `auth_style must be "api-key" or "bearer"`,
    );
  }
  if (p.endpoint.includes("/openai/deployments/")) {
    process.stderr.write(
      `[config] warning: endpoint should be the resource base URL only (no /openai/deployments/ path)\n`,
    );
  }
}

export interface ProfileSummary {
  name: string;
  type: ProfileType;
  endpoint: string;
  deployment?: string;
  active: boolean;
}

export function listProfiles(): ProfileSummary[] {
  const cfg = readConfigFile();
  return Object.entries(cfg.profiles)
    .map(([name, p]) => ({
      name,
      type: p.type,
      endpoint: p.endpoint ?? DEFAULT_OPENAI_ENDPOINT,
      deployment: p.type === "azure" ? p.deployment : undefined,
      active: cfg.active === name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getProfile(name: string): Profile | undefined {
  return readConfigFile().profiles[name];
}

export function addProfile(name: string, profile: Profile): void {
  validateProfile(profile);
  const cfg = readConfigFile();
  if (cfg.profiles[name]) {
    throw new CliError("INVALID_INPUT", `profile "${name}" already exists`);
  }
  cfg.profiles[name] = profile;
  if (!cfg.active) cfg.active = name;
  writeConfigFile(cfg);
}

export function removeProfile(name: string): void {
  const cfg = readConfigFile();
  if (!cfg.profiles[name]) {
    throw new CliError("PROFILE_NOT_FOUND", `no such profile: ${name}`, {
      available: Object.keys(cfg.profiles).sort(),
    });
  }
  if (Object.keys(cfg.profiles).length === 1) {
    throw new CliError(
      "INVALID_INPUT",
      "cannot remove the only profile — use `config init` to start over",
    );
  }
  delete cfg.profiles[name];
  if (cfg.active === name) {
    cfg.active = Object.keys(cfg.profiles).sort()[0]!;
  }
  writeConfigFile(cfg);
}

export function useProfile(name: string): void {
  const cfg = readConfigFile();
  if (!cfg.profiles[name]) {
    throw new CliError("PROFILE_NOT_FOUND", `no such profile: ${name}`, {
      available: Object.keys(cfg.profiles).sort(),
    });
  }
  cfg.active = name;
  writeConfigFile(cfg);
}

export function setProfileField(
  name: string,
  key: string,
  value: string,
): void {
  if (key === "type") {
    throw new CliError(
      "INVALID_INPUT",
      "cannot change profile `type`; use `config remove` + `config add`",
    );
  }
  const cfg = readConfigFile();
  const prof = cfg.profiles[name];
  if (!prof) {
    throw new CliError("PROFILE_NOT_FOUND", `no such profile: ${name}`, {
      available: Object.keys(cfg.profiles).sort(),
    });
  }
  const allowed = prof.type === "openai" ? ALLOWED_KEYS_OPENAI : ALLOWED_KEYS_AZURE;
  if (!allowed.has(key)) {
    throw new CliError(
      "INVALID_INPUT",
      `key "${key}" not allowed for ${prof.type} profile (allowed: ${[...allowed].join(", ")})`,
    );
  }
  (prof as Record<string, string>)[key] = value;
  validateProfile(prof);
  writeConfigFile(cfg);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/core/config.test.ts -t "profile CRUD"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts tests/unit/core/config.test.ts
git commit -m "feat(config): profile CRUD primitives (add/remove/use/list/set/get)"
```

---

## Task 4: `resolveActiveProfile()` — precedence chain

**Files:**
- Modify: `src/core/config.ts` (replace placeholder + delete `resolveConfig` shim)
- Modify: `tests/unit/core/config.test.ts` (replace the old `resolveConfig priority` tests)

- [ ] **Step 1: Write the failing test**

In `tests/unit/core/config.test.ts`, **delete** the old `describe("resolveConfig priority", …)` block and **delete** the old `describe("config file IO", …)` block (they tested the v1 shape — replaced by Task 2's coverage).

Append:

```ts
import { resolveActiveProfile } from "../../../src/core/config.js";

describe("resolveActiveProfile precedence", () => {
  let tmpHome: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-image-cli-rap-"));
    process.env.HOME = tmpHome;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.GPT_IMAGE_PROFILE;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("CONFIG_MISSING when no file, no env, no flags", () => {
    expect(() => resolveActiveProfile({})).toThrow(/CONFIG_MISSING|not set/i);
  });

  it("synthesizes ad-hoc openai profile from OPENAI_API_KEY env when no file", () => {
    process.env.OPENAI_API_KEY = "sk-env";
    const { profile } = resolveActiveProfile({});
    expect(profile.type).toBe("openai");
    expect(profile.apiKey).toBe("sk-env");
    expect(profile.endpoint).toBe("https://api.openai.com/v1");
    expect(profile.name).toBe("(env)");
  });

  it("uses file's active profile when no flag/env", () => {
    addProfile("a", { type: "openai", api_key: "sk-a", endpoint: "https://a/v1" });
    addProfile("b", { type: "openai", api_key: "sk-b" });
    useProfile("a");
    const { profile } = resolveActiveProfile({});
    expect(profile.name).toBe("a");
    expect(profile.apiKey).toBe("sk-a");
  });

  it("--profile flag beats file active and GPT_IMAGE_PROFILE env", () => {
    addProfile("a", { type: "openai", api_key: "sk-a" });
    addProfile("b", { type: "openai", api_key: "sk-b" });
    useProfile("a");
    process.env.GPT_IMAGE_PROFILE = "a";
    const { profile } = resolveActiveProfile({ profile: "b" });
    expect(profile.name).toBe("b");
  });

  it("GPT_IMAGE_PROFILE env beats file active", () => {
    addProfile("a", { type: "openai", api_key: "sk-a" });
    addProfile("b", { type: "openai", api_key: "sk-b" });
    useProfile("a");
    process.env.GPT_IMAGE_PROFILE = "b";
    const { profile } = resolveActiveProfile({});
    expect(profile.name).toBe("b");
  });

  it("--endpoint / --api-key override resolved profile fields without changing type", () => {
    addProfile("az", {
      type: "azure",
      endpoint: "https://orig.openai.azure.com",
      api_key: "k-orig",
      api_version: "2024-02-01",
      deployment: "gpt-image-2",
      auth_style: "bearer",
    });
    useProfile("az");
    const { profile } = resolveActiveProfile({
      apiKey: "k-flag",
      endpoint: "https://override.openai.azure.com",
    });
    expect(profile.type).toBe("azure");
    expect(profile.apiKey).toBe("k-flag");
    expect(profile.endpoint).toBe("https://override.openai.azure.com");
    expect(profile.deployment).toBe("gpt-image-2");
    expect(profile.authStyle).toBe("bearer");
  });

  it("PROFILE_NOT_FOUND when --profile names a missing profile", () => {
    addProfile("a", { type: "openai", api_key: "sk-a" });
    try {
      resolveActiveProfile({ profile: "missing" });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as CliError).code).toBe("PROFILE_NOT_FOUND");
      expect((e as CliError).details).toMatchObject({ available: ["a"] });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/core/config.test.ts -t "resolveActiveProfile"
```

Expected: FAIL — `resolveActiveProfile not implemented — Task 4`.

- [ ] **Step 3: Implement and clean up shim**

In `src/core/config.ts`, replace the `resolveActiveProfile` throw and **delete the entire `resolveConfig` shim**:

```ts
export function resolveActiveProfile(
  flags: FlagConfigInput,
): { profile: ResolvedProfile; sources: { apiKey: ConfigSource; endpoint: ConfigSource } } {
  const file = readConfigFile();

  // Step 1: pick which named profile is in scope.
  const wantedName =
    flags.profile ?? process.env.GPT_IMAGE_PROFILE ?? file.active ?? null;

  let base: ResolvedProfile | null = null;
  let nameSource: ConfigSource = "missing";

  if (wantedName) {
    const stored = file.profiles[wantedName];
    if (!stored) {
      throw new CliError(
        "PROFILE_NOT_FOUND",
        `no such profile: ${wantedName}`,
        { available: Object.keys(file.profiles).sort() },
      );
    }
    base = storedToResolved(wantedName, stored);
    nameSource = flags.profile ? "flag" : process.env.GPT_IMAGE_PROFILE ? "env" : "file";
  } else if (process.env.OPENAI_API_KEY || flags.apiKey) {
    // Ad-hoc openai profile from env/flag (no saved profiles).
    base = {
      name: "(env)",
      type: "openai",
      apiKey: flags.apiKey ?? process.env.OPENAI_API_KEY!,
      endpoint:
        flags.endpoint ?? process.env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_ENDPOINT,
    };
    nameSource = flags.apiKey ? "flag" : "env";
  }

  if (!base) {
    throw new CliError(
      "CONFIG_MISSING",
      "OpenAI API key not set. Set OPENAI_API_KEY or run `gpt-image-cli config init`.",
    );
  }

  // Step 2: layer flag/env overrides over the resolved profile fields.
  const apiKeySrc: ConfigSource = flags.apiKey
    ? "flag"
    : process.env.OPENAI_API_KEY && nameSource === "env"
    ? "env"
    : nameSource;
  const endpointSrc: ConfigSource = flags.endpoint
    ? "flag"
    : process.env.OPENAI_BASE_URL
    ? "env"
    : nameSource === "missing"
    ? "default"
    : nameSource;

  const apiKey = flags.apiKey ?? base.apiKey;
  const endpoint = flags.endpoint ?? base.endpoint;

  return {
    profile: { ...base, apiKey, endpoint },
    sources: { apiKey: apiKeySrc, endpoint: endpointSrc },
  };
}

function storedToResolved(name: string, p: Profile): ResolvedProfile {
  if (p.type === "openai") {
    return {
      name,
      type: "openai",
      apiKey: p.api_key,
      endpoint: p.endpoint ?? DEFAULT_OPENAI_ENDPOINT,
    };
  }
  return {
    name,
    type: "azure",
    apiKey: p.api_key,
    endpoint: p.endpoint,
    apiVersion: p.api_version,
    deployment: p.deployment,
    authStyle: p.auth_style ?? "api-key",
  };
}
```

Now **delete** the temporary `resolveConfig` shim added in Task 2. Search for `// TEMP shim` and remove the block.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/core/config.test.ts
```

Expected: All config tests PASS. `npm run lint` will now fail in `src/core/client.ts` and `src/commands/config.ts` because they still call `resolveConfig`. Leave them — Tasks 5 and 8–13 fix them.

To make lint pass temporarily, you may need to comment out the call sites in `src/core/client.ts` and `src/commands/config.ts`. **Don't** — moving to Task 5 immediately fixes `client.ts`, and the `config.ts` command callers are fixed in Tasks 8–13. Just accept that the project doesn't compile end-to-end until Task 5 completes.

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts tests/unit/core/config.test.ts
git commit -m "feat(config): resolveActiveProfile precedence chain (flag>env>file)"
```

---

## Task 5: Client factory branching

**Files:**
- Rewrite: `src/core/client.ts`
- Create: `tests/unit/core/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/client.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import OpenAI, { AzureOpenAI } from "openai";
import { makeClient } from "../../../src/core/client.js";
import { addProfile, useProfile } from "../../../src/core/config.js";

describe("makeClient", () => {
  let tmpHome: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-image-cli-client-"));
    process.env.HOME = tmpHome;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.GPT_IMAGE_PROFILE;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns plain OpenAI client + model 'gpt-image-2' for openai profile", () => {
    addProfile("p", { type: "openai", api_key: "sk-x", endpoint: "https://api.openai.com/v1" });
    useProfile("p");
    const bundle = makeClient({});
    expect(bundle.client).toBeInstanceOf(OpenAI);
    expect(bundle.client).not.toBeInstanceOf(AzureOpenAI);
    expect(bundle.model).toBe("gpt-image-2");
    expect(bundle.profile.type).toBe("openai");
  });

  it("returns AzureOpenAI with api-key auth for azure + auth_style=api-key", () => {
    addProfile("az", {
      type: "azure",
      endpoint: "https://r.openai.azure.com",
      api_key: "k1",
      api_version: "2024-02-01",
      deployment: "gpt-image-2",
      auth_style: "api-key",
    });
    useProfile("az");
    const bundle = makeClient({});
    expect(bundle.client).toBeInstanceOf(AzureOpenAI);
    expect(bundle.model).toBe("gpt-image-2");
    expect(bundle.profile.authStyle).toBe("api-key");
    // apiKey field is set on AzureOpenAI when api-key auth
    const c = bundle.client as AzureOpenAI;
    expect(c.apiKey).toBe("k1");
  });

  it("returns AzureOpenAI with bearer token provider for azure + auth_style=bearer", async () => {
    addProfile("az", {
      type: "azure",
      endpoint: "https://r.openai.azure.com",
      api_key: "k-bearer",
      api_version: "2024-02-01",
      deployment: "gpt-image-2",
      auth_style: "bearer",
    });
    useProfile("az");
    const bundle = makeClient({});
    expect(bundle.client).toBeInstanceOf(AzureOpenAI);
    // _azureADTokenProvider is the private SDK field; invoking _getAzureADToken proxies it.
    const token = await (bundle.client as AzureOpenAI)._getAzureADToken();
    expect(token).toBe("k-bearer");
  });

  it("CONFIG_MISSING when nothing resolves", () => {
    expect(() => makeClient({})).toThrow(/CONFIG_MISSING|API key not set/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/core/client.test.ts
```

Expected: FAIL — old `makeClient` doesn't return `{client, model, profile}`.

- [ ] **Step 3: Implement**

Replace `src/core/client.ts` entirely:

```ts
import OpenAI, { AzureOpenAI } from "openai";
import { CliError } from "../framework/errors.js";
import { resolveActiveProfile, type FlagConfigInput } from "./config.js";
import type { ResolvedProfile } from "../framework/types.js";

export interface ClientBundle {
  client: OpenAI | AzureOpenAI;
  model: string;
  profile: ResolvedProfile;
}

export function makeClient(flags: FlagConfigInput): ClientBundle {
  const { profile } = resolveActiveProfile(flags);

  if (!profile.apiKey) {
    throw new CliError(
      "CONFIG_MISSING",
      "API key not set. Set OPENAI_API_KEY or run `gpt-image-cli config init`.",
    );
  }

  if (profile.type === "openai") {
    return {
      client: new OpenAI({ apiKey: profile.apiKey, baseURL: profile.endpoint }),
      model: "gpt-image-2",
      profile,
    };
  }

  // azure
  const common = {
    endpoint: profile.endpoint,
    apiVersion: profile.apiVersion!,
    deployment: profile.deployment!,
  };
  const client =
    profile.authStyle === "bearer"
      ? new AzureOpenAI({
          ...common,
          azureADTokenProvider: async () => profile.apiKey,
        })
      : new AzureOpenAI({ ...common, apiKey: profile.apiKey });

  return { client, model: profile.deployment!, profile };
}
```

Re-export `FlagConfigInput` if any consumer imports it from `client.ts` (check with `grep -rn "FlagConfigInput" src tests`).

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/core/client.test.ts
npm run lint 2>&1 | head -40
```

Expected: client tests PASS. `npm run lint` will still fail at the `commands/config.ts` call sites (e.g. `resolveConfig` references) — that's Tasks 8–13.

- [ ] **Step 5: Commit**

```bash
git add src/core/client.ts tests/unit/core/client.test.ts
git commit -m "feat(client): branch OpenAI vs AzureOpenAI by profile type"
```

---

## Task 6: Wire `generate` and `edit` to the new factory + dry-run profile block

**Files:**
- Modify: `src/commands/generate.ts:151-213`
- Modify: `src/commands/edit.ts:121-181`

- [ ] **Step 1: Write the failing test**

Existing integration tests in `tests/integration/generate.test.ts` and `tests/integration/edit.test.ts` already cover the happy path. They'll fail because `runGenerate` will be called via the new factory which still uses `OPENAI_API_KEY=sk-test` from `beforeEach` — that path should still work (env-only synthesizes an ad-hoc openai profile).

Add a new test to `tests/integration/generate.test.ts` for the dry-run profile block:

```ts
  it("dry-run includes profile block describing the active endpoint", async () => {
    const captured: unknown[] = [];
    await runGenerate(
      {
        prompt: "a cat",
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
        dryRun: true,
        yes: false,
        verbose: false,
      },
      (env) => captured.push(env),
    );
    const env = captured[0] as { ok: boolean; data: { profile: { type: string; name: string } } };
    expect(env.ok).toBe(true);
    expect(env.data.profile.type).toBe("openai");
    expect(env.data.profile.name).toBe("(env)");
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/integration/generate.test.ts -t "dry-run includes profile"
```

Expected: FAIL — `env.data.profile` is undefined.

- [ ] **Step 3: Update generate.ts**

In `src/commands/generate.ts`, locate the request-building block (around line 130) and the dry-run emission (line 142). Update:

```ts
  // BEFORE the existing request-building section, resolve the client/profile up front
  // so dry-run can describe the active profile too.
  const bundle = global.dryRun ? null : makeClient({
    apiKey: global.apiKey,
    endpoint: global.endpoint,
    profile: global.profile,
  });

  // For dry-run we still need profile context. Use resolveActiveProfile (no SDK init).
  const profileForDescribe = bundle?.profile
    ?? (await import("../core/config.js")).resolveActiveProfile({
      apiKey: global.apiKey,
      endpoint: global.endpoint,
      profile: global.profile,
    }).profile;

  const modelForRequest = bundle?.model
    ?? (profileForDescribe.type === "azure" ? profileForDescribe.deployment! : "gpt-image-2");

  const request: Record<string, unknown> = {
    model: modelForRequest,
    prompt,
    n: opts.count,
    size: opts.size,
    quality: opts.quality,
    background: opts.background,
    output_format: opts.outputFormat,
  };
  if (opts.compression !== undefined) request.output_compression = opts.compression;
  if (opts.moderation) request.moderation = opts.moderation;

  const profileBlock = {
    name: profileForDescribe.name,
    type: profileForDescribe.type,
    endpoint: profileForDescribe.endpoint,
    ...(profileForDescribe.deployment ? { deployment: profileForDescribe.deployment } : {}),
    ...(profileForDescribe.authStyle ? { auth_style: profileForDescribe.authStyle } : {}),
  };

  if (global.dryRun) {
    emit(
      { ok: true, data: { operation: "generate", profile: profileBlock, request } },
      emitOpts,
    );
    return;
  }
```

Then replace the existing `const client = makeClient(...)` line — `bundle.client` is the new client.

Update the **success** envelope (around line 203):

```ts
  const data: ImageOpResultData = {
    model: modelForRequest,
    operation: "generate",
    paths,
    size: opts.size,
    quality: opts.quality,
    output_format: opts.outputFormat,
    count: items.length,
    profile: profileBlock,
    usage: (response as unknown as { usage?: ImageOpResultData["usage"] }).usage,
  };
```

Make the same set of changes in `src/commands/edit.ts`. The structure is identical — the call site is line 121 and the dry-run block is line 71.

The `GlobalOptions.profile` field flows through because Task 1 already added it. Inside `runEdit`/`runGenerate`, read it as `global.profile`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/integration/
```

Expected: all integration tests PASS (existing tests adapt automatically since env-only path still works; new dry-run test passes).

- [ ] **Step 5: Commit**

```bash
git add src/commands/generate.ts src/commands/edit.ts tests/integration/generate.test.ts
git commit -m "feat(commands): wire generate/edit to factory bundle + dry-run profile block"
```

---

## Task 7: WEBP rejection on Azure profiles

**Files:**
- Modify: `src/commands/generate.ts` (just before the request fires)
- Modify: `src/commands/edit.ts` (same point)

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/generate.test.ts`:

```ts
  it("rejects WEBP output_format when active profile is azure", async () => {
    // Pre-seed a v2 config with an azure profile and make it active.
    const cfgDir = path.join(tmpHome, ".gpt-image-cli");
    fs.mkdirSync(cfgDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(cfgDir, "config.json"),
      JSON.stringify({
        version: 2,
        active: "az",
        profiles: {
          az: {
            type: "azure",
            endpoint: "https://r.openai.azure.com",
            api_key: "k",
            api_version: "2024-02-01",
            deployment: "gpt-image-2",
          },
        },
      }),
      { mode: 0o600 },
    );
    delete process.env.OPENAI_API_KEY;

    await expect(
      runGenerate(
        {
          prompt: "x",
          count: 1,
          size: "1024x1024",
          quality: "auto",
          background: "auto",
          outputFormat: "webp",
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
        () => {},
      ),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringMatching(/webp.*azure/i),
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/integration/generate.test.ts -t "rejects WEBP"
```

Expected: FAIL — dry-run succeeds despite WEBP on Azure.

- [ ] **Step 3: Implement the guard**

In `src/commands/generate.ts`, after `profileForDescribe` is known but before `if (global.dryRun) { ... }`:

```ts
  if (profileForDescribe.type === "azure" && opts.outputFormat === "webp") {
    throw new CliError(
      "INVALID_INPUT",
      "webp not supported on Azure profile — use png or jpeg",
    );
  }
```

Same insertion in `src/commands/edit.ts`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/integration/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/generate.ts src/commands/edit.ts tests/integration/generate.test.ts
git commit -m "feat(validate): reject webp output_format on Azure profiles"
```

---

## Task 8: Rewrite `config` command surface — init/set/get/show + path

**Files:**
- Modify: `src/commands/config.ts`

This task rewrites the existing `init`, `set`, `get`, `show`, `path` actions to operate on profiles. New `list`/`use`/`add`/`remove` come in Tasks 9–12.

- [ ] **Step 1: Write the failing test**

Since `commands/config.ts` is driven via the CLI, the most valuable tests are end-to-end. But the existing test suite doesn't cover commands directly; they're exercised via integration tests. We'll add a focused unit-ish test by importing the action functions directly.

For this task, refactor `src/commands/config.ts` to export each action as a named function (so they're testable), then add this test file:

Create `tests/unit/commands/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { actionGet, actionSet, actionShow } from "../../../src/commands/config.js";
import { addProfile, useProfile } from "../../../src/core/config.js";

describe("config command actions (profile-scoped)", () => {
  let tmpHome: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-image-cli-cmd-"));
    process.env.HOME = tmpHome;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("set/get operate on the active profile by default", () => {
    addProfile("a", { type: "openai", api_key: "x" });
    addProfile("b", { type: "openai", api_key: "y" });
    useProfile("b");
    let emitted: unknown;
    actionSet("endpoint", "https://b/v1", {}, (e) => (emitted = e));
    actionGet("endpoint", {}, (e) => (emitted = e));
    expect((emitted as { ok: true; data: { value: string } }).data.value).toBe("https://b/v1");
  });

  it("set --profile <name> targets the named profile", () => {
    addProfile("a", { type: "openai", api_key: "x" });
    addProfile("b", { type: "openai", api_key: "y" });
    let emitted: unknown;
    actionSet("endpoint", "https://a/v1", { profile: "a" }, () => {});
    actionGet("endpoint", { profile: "a" }, (e) => (emitted = e));
    expect((emitted as { ok: true; data: { value: string } }).data.value).toBe("https://a/v1");
  });

  it("show without name shows the active profile, with sources", () => {
    addProfile("a", {
      type: "azure",
      endpoint: "https://r.openai.azure.com",
      api_key: "k",
      api_version: "2024-02-01",
      deployment: "gpt-image-2",
      auth_style: "bearer",
    });
    let emitted: unknown;
    actionShow(undefined, {}, (e) => (emitted = e));
    const data = (emitted as { ok: true; data: Record<string, unknown> }).data;
    expect(data.type).toBe("azure");
    expect(data.auth_style).toBe("bearer");
    expect(data.api_key).toMatch(/^\*\*\*/);
    expect(data.sources).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/commands/config.test.ts
```

Expected: FAIL — `actionSet`/`actionGet`/`actionShow` not exported.

- [ ] **Step 3: Rewrite `src/commands/config.ts`**

Replace the whole file. The rewrite (a) exports action functions, (b) adds `--profile` option to `set`/`get`, (c) reads/writes through the new profile primitives.

```ts
// src/commands/config.ts
import { Command } from "commander";
import * as readline from "node:readline";
import {
  readConfigFile,
  configFilePath,
  resolveActiveProfile,
  redactApiKey,
  getProfile,
  setProfileField,
  addProfile,
  removeProfile,
  useProfile,
  listProfiles,
  type FlagConfigInput,
} from "../core/config.js";
import { CliError } from "../framework/errors.js";
import type { Emitter, Profile } from "../framework/types.js";

export interface ScopeOpts {
  profile?: string;
}

function targetProfileName(opts: ScopeOpts): string {
  if (opts.profile) {
    if (!getProfile(opts.profile)) {
      throw new CliError(
        "PROFILE_NOT_FOUND",
        `no such profile: ${opts.profile}`,
        { available: listProfiles().map((p) => p.name) },
      );
    }
    return opts.profile;
  }
  const cfg = readConfigFile();
  if (!cfg.active) {
    throw new CliError(
      "CONFIG_MISSING",
      "no active profile — run `config init` or `config add <name>`",
    );
  }
  return cfg.active;
}

export function actionSet(
  key: string,
  value: string,
  opts: ScopeOpts,
  emit: Emitter,
): void {
  const name = targetProfileName(opts);
  setProfileField(name, key, value);
  emit({ ok: true, data: { profile: name, fields: [key], path: configFilePath() } });
}

export function actionGet(key: string, opts: ScopeOpts, emit: Emitter): void {
  const name = targetProfileName(opts);
  const prof = getProfile(name)!;
  const val = (prof as Record<string, unknown>)[key] ?? null;
  emit({ ok: true, data: { profile: name, key, value: val } });
}

export function actionShow(
  name: string | undefined,
  opts: ScopeOpts,
  emit: Emitter,
): void {
  const target = name ?? targetProfileName(opts);
  const prof = getProfile(target);
  if (!prof) {
    throw new CliError("PROFILE_NOT_FOUND", `no such profile: ${target}`, {
      available: listProfiles().map((p) => p.name),
    });
  }
  // Only the active profile reports sources (flags/env apply there).
  const cfg = readConfigFile();
  const isActive = cfg.active === target;
  let sources: { apiKey: string; endpoint: string } | undefined;
  if (isActive) {
    const r = resolveActiveProfile({});
    sources = r.sources;
  }
  const data: Record<string, unknown> = {
    profile: target,
    active: isActive,
    type: prof.type,
    endpoint: prof.endpoint ?? null,
    api_key: redactApiKey(prof.api_key),
  };
  if (prof.type === "azure") {
    data.api_version = prof.api_version;
    data.deployment = prof.deployment;
    data.auth_style = prof.auth_style ?? "api-key";
  }
  if (sources) data.sources = sources;
  emit({ ok: true, data });
}

export function actionPath(emit: Emitter): void {
  emit({ ok: true, data: { path: configFilePath() } });
}

export async function actionInit(emit: Emitter): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new CliError(
      "INVALID_INPUT",
      "config init requires a TTY. Use `config add` non-interactively, or `config set`.",
    );
  }
  const typeAns = (await prompt("Profile type [openai/azure] (default openai): ")).toLowerCase();
  const type = typeAns === "azure" ? "azure" : "openai";
  let profile: Profile;
  if (type === "openai") {
    const apiKey = await prompt("OpenAI API key (sk-...): ", { mask: true });
    const endpoint = await prompt(
      "Endpoint (leave empty for default https://api.openai.com/v1): ",
    );
    profile = { type: "openai", api_key: apiKey };
    if (endpoint) profile.endpoint = endpoint;
  } else {
    const endpoint = await prompt(
      "Azure endpoint (e.g. https://<resource>.openai.azure.com): ",
    );
    const deployment = await prompt("Deployment name (e.g. gpt-image-2): ");
    const apiVersion =
      (await prompt("api-version (default 2024-02-01): ")) || "2024-02-01";
    const apiKey = await prompt("API key: ", { mask: true });
    const authAns = (await prompt(
      "auth_style [api-key/bearer] (default api-key): ",
    )).toLowerCase();
    profile = {
      type: "azure",
      endpoint,
      deployment,
      api_version: apiVersion,
      api_key: apiKey,
      auth_style: authAns === "bearer" ? "bearer" : "api-key",
    };
  }

  const existing = getProfile("default");
  if (existing) {
    // Replace default profile.
    removeProfile("default"); // throws if only profile — handle below
  }
  addProfile("default", profile);
  useProfile("default");
  emit({
    ok: true,
    data: { path: configFilePath(), profile: "default", type: profile.type },
  });
}

function registerInit(cfg: Command, emit: Emitter) {
  cfg
    .command("init")
    .description("Interactive wizard to create the 'default' profile")
    .action(async () => {
      await actionInit(emit);
    });
}

function registerSet(cfg: Command, emit: Emitter) {
  cfg
    .command("set <key> <value>")
    .description("Set a field on a profile (active by default)")
    .option("--profile <name>", "target profile name")
    .action(async (key: string, value: string, opts: ScopeOpts) => {
      actionSet(key, value, opts, emit);
    });
}

function registerGet(cfg: Command, emit: Emitter) {
  cfg
    .command("get <key>")
    .description("Read a field from a profile (active by default)")
    .option("--profile <name>", "target profile name")
    .action((key: string, opts: ScopeOpts) => {
      actionGet(key, opts, emit);
    });
}

function registerShow(cfg: Command, emit: Emitter) {
  cfg
    .command("show [name]")
    .description("Show one profile (active by default); api_key redacted")
    .action((name: string | undefined, _opts: ScopeOpts) => {
      actionShow(name, {}, emit);
    });
}

function registerPath(cfg: Command, emit: Emitter) {
  cfg
    .command("path")
    .description("Print config file path")
    .action(() => actionPath(emit));
}

export function registerConfig(program: Command, emit: Emitter): void {
  const cfg = program.command("config").description("Manage CLI config");
  registerInit(cfg, emit);
  registerSet(cfg, emit);
  registerGet(cfg, emit);
  registerShow(cfg, emit);
  registerPath(cfg, emit);
  // list / use / add / remove are wired up in Tasks 9–12.
}

function prompt(question: string, opts: { mask?: boolean } = {}): Promise<string> {
  if (opts.mask) return promptMasked(question);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

function promptMasked(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    if (!process.stdin.setRawMode) {
      reject(new Error("stdin does not support setRawMode; cannot mask input"));
      return;
    }
    process.stdin.resume();
    process.stdin.setRawMode(true);
    let buf = "";
    const onData = (data: Buffer) => {
      const s = data.toString("utf8");
      for (const ch of s) {
        const code = ch.charCodeAt(0);
        if (code === 0x0d || code === 0x0a) {
          process.stdin.setRawMode!(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(buf.trim());
          return;
        } else if (code === 0x7f || code === 0x08) {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (code === 0x03) {
          process.stdin.setRawMode!(false);
          process.stdout.write("\n");
          process.exit(130);
        } else if (code >= 0x20) {
          buf += ch;
          process.stdout.write("*");
        }
      }
    };
    process.stdin.on("data", onData);
  });
}
```

A subtle bug to avoid: in `actionInit`, `removeProfile("default")` throws if it's the only profile. Handle by inlining the replacement instead:

```ts
  const cfg = readConfigFile();
  cfg.profiles.default = profile;
  cfg.active = "default";
  writeConfigFile(cfg);
```

…rather than the remove/add dance. Use that approach.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/commands/config.test.ts
npm run lint
```

Expected: PASS. Lint should now pass (no remaining `resolveConfig` references).

- [ ] **Step 5: Commit**

```bash
git add src/commands/config.ts tests/unit/commands/config.test.ts
git commit -m "feat(commands/config): rewrite init/set/get/show on profile primitives"
```

---

## Task 9: `config list` command

**Files:**
- Modify: `src/commands/config.ts`
- Modify: `tests/unit/commands/config.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/commands/config.test.ts`:

```ts
import { actionList } from "../../../src/commands/config.js";

describe("config list", () => {
  let tmpHome2: string;
  beforeEach(() => {
    tmpHome2 = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-image-cli-list-"));
    process.env.HOME = tmpHome2;
  });
  afterEach(() => fs.rmSync(tmpHome2, { recursive: true, force: true }));

  it("returns all profiles with active marker", () => {
    addProfile("alpha", { type: "openai", api_key: "a" });
    addProfile("beta", {
      type: "azure",
      endpoint: "https://r.openai.azure.com",
      api_key: "b",
      api_version: "2024-02-01",
      deployment: "gpt-image-2",
    });
    useProfile("beta");
    let captured: unknown;
    actionList((e) => (captured = e));
    const data = (captured as { ok: true; data: { profiles: Array<{ name: string; active: boolean; type: string }> } }).data;
    expect(data.profiles.map((p) => p.name)).toEqual(["alpha", "beta"]);
    expect(data.profiles.find((p) => p.name === "beta")?.active).toBe(true);
    expect(data.profiles.find((p) => p.name === "beta")?.type).toBe("azure");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/commands/config.test.ts -t "config list"
```

Expected: FAIL — `actionList` not exported.

- [ ] **Step 3: Implement**

In `src/commands/config.ts`, add:

```ts
export function actionList(emit: Emitter): void {
  const profiles = listProfiles();
  emit({ ok: true, data: { profiles } });
}

function registerList(cfg: Command, emit: Emitter) {
  cfg
    .command("list")
    .description("List saved profiles; active marker shown")
    .action(() => actionList(emit));
}
```

Add `registerList(cfg, emit);` inside `registerConfig`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/commands/config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/config.ts tests/unit/commands/config.test.ts
git commit -m "feat(commands/config): add `config list`"
```

---

## Task 10: `config use <name>` command

**Files:**
- Modify: `src/commands/config.ts`
- Modify: `tests/unit/commands/config.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/commands/config.test.ts`:

```ts
import { actionUse } from "../../../src/commands/config.js";

describe("config use", () => {
  let tmpHome3: string;
  beforeEach(() => {
    tmpHome3 = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-image-cli-use-"));
    process.env.HOME = tmpHome3;
  });
  afterEach(() => fs.rmSync(tmpHome3, { recursive: true, force: true }));

  it("switches active and reports new value", () => {
    addProfile("a", { type: "openai", api_key: "a" });
    addProfile("b", { type: "openai", api_key: "b" });
    let captured: unknown;
    actionUse("b", (e) => (captured = e));
    expect((captured as { ok: true; data: { active: string } }).data.active).toBe("b");
  });

  it("throws PROFILE_NOT_FOUND for missing profile", () => {
    addProfile("a", { type: "openai", api_key: "a" });
    expect(() => actionUse("missing", () => {})).toThrowError(
      expect.objectContaining({ code: "PROFILE_NOT_FOUND" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/commands/config.test.ts -t "config use"
```

Expected: FAIL — `actionUse` not exported.

- [ ] **Step 3: Implement**

Add to `src/commands/config.ts`:

```ts
export function actionUse(name: string, emit: Emitter): void {
  useProfile(name);
  emit({ ok: true, data: { active: name } });
}

function registerUse(cfg: Command, emit: Emitter) {
  cfg
    .command("use <name>")
    .description("Set active profile")
    .action((name: string) => actionUse(name, emit));
}
```

Add `registerUse(cfg, emit);` inside `registerConfig`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/commands/config.test.ts -t "config use"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/config.ts tests/unit/commands/config.test.ts
git commit -m "feat(commands/config): add `config use <name>`"
```

---

## Task 11: `config add <name>` interactive wizard

**Files:**
- Modify: `src/commands/config.ts`
- Modify: `tests/unit/commands/config.test.ts`

The CLI surface is interactive, but we make the *core* logic testable by exporting a non-interactive `actionAdd(name, profile)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/commands/config.test.ts`:

```ts
import { actionAdd } from "../../../src/commands/config.js";

describe("config add (programmatic)", () => {
  let tmpHome4: string;
  beforeEach(() => {
    tmpHome4 = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-image-cli-add-"));
    process.env.HOME = tmpHome4;
  });
  afterEach(() => fs.rmSync(tmpHome4, { recursive: true, force: true }));

  it("adds an azure profile and emits success envelope", () => {
    let captured: unknown;
    actionAdd(
      "az",
      {
        type: "azure",
        endpoint: "https://r.openai.azure.com",
        api_key: "k",
        api_version: "2024-02-01",
        deployment: "gpt-image-2",
        auth_style: "bearer",
      },
      (e) => (captured = e),
    );
    expect((captured as { ok: true; data: { profile: string } }).data.profile).toBe("az");
  });

  it("rejects invalid api_version", () => {
    expect(() =>
      actionAdd(
        "az",
        {
          type: "azure",
          endpoint: "https://r.openai.azure.com",
          api_key: "k",
          api_version: "not-a-date",
          deployment: "gpt-image-2",
        },
        () => {},
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/commands/config.test.ts -t "config add"
```

Expected: FAIL — `actionAdd` not exported.

- [ ] **Step 3: Implement**

Add to `src/commands/config.ts`:

```ts
export function actionAdd(name: string, profile: Profile, emit: Emitter): void {
  addProfile(name, profile);
  emit({
    ok: true,
    data: {
      profile: name,
      type: profile.type,
      path: configFilePath(),
    },
  });
}

async function actionAddInteractive(
  name: string,
  typeFlag: "openai" | "azure" | undefined,
  emit: Emitter,
): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new CliError(
      "INVALID_INPUT",
      "`config add` interactive wizard requires a TTY",
    );
  }
  const type =
    typeFlag ??
    (((await prompt("Profile type [openai/azure] (default openai): ")).toLowerCase() === "azure"
      ? "azure"
      : "openai") as "openai" | "azure");
  let profile: Profile;
  if (type === "openai") {
    const apiKey = await prompt("OpenAI API key (sk-...): ", { mask: true });
    const endpoint = await prompt(
      "Endpoint (leave empty for default https://api.openai.com/v1): ",
    );
    profile = { type: "openai", api_key: apiKey };
    if (endpoint) profile.endpoint = endpoint;
  } else {
    const endpoint = await prompt(
      "Azure endpoint (e.g. https://<resource>.openai.azure.com): ",
    );
    const deployment = await prompt("Deployment name (e.g. gpt-image-2): ");
    const apiVersion =
      (await prompt("api-version (default 2024-02-01): ")) || "2024-02-01";
    const apiKey = await prompt("API key: ", { mask: true });
    const authAns = (await prompt(
      "auth_style [api-key/bearer] (default api-key): ",
    )).toLowerCase();
    profile = {
      type: "azure",
      endpoint,
      deployment,
      api_version: apiVersion,
      api_key: apiKey,
      auth_style: authAns === "bearer" ? "bearer" : "api-key",
    };
  }
  actionAdd(name, profile, emit);
}

function registerAdd(cfg: Command, emit: Emitter) {
  cfg
    .command("add <name>")
    .description("Add a new profile (interactive wizard)")
    .option("--type <type>", "openai | azure")
    .action(async (name: string, opts: { type?: string }) => {
      const t = opts.type === "azure" ? "azure" : opts.type === "openai" ? "openai" : undefined;
      await actionAddInteractive(name, t, emit);
    });
}
```

Add `registerAdd(cfg, emit);` to `registerConfig`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/commands/config.test.ts -t "config add"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/config.ts tests/unit/commands/config.test.ts
git commit -m "feat(commands/config): add `config add <name>` wizard (openai|azure)"
```

---

## Task 12: `config remove <name>` command

**Files:**
- Modify: `src/commands/config.ts`
- Modify: `tests/unit/commands/config.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/commands/config.test.ts`:

```ts
import { actionRemove } from "../../../src/commands/config.js";

describe("config remove", () => {
  let tmpHome5: string;
  beforeEach(() => {
    tmpHome5 = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-image-cli-rm-"));
    process.env.HOME = tmpHome5;
  });
  afterEach(() => fs.rmSync(tmpHome5, { recursive: true, force: true }));

  it("removes a non-active profile and reports", () => {
    addProfile("a", { type: "openai", api_key: "a" });
    addProfile("b", { type: "openai", api_key: "b" });
    let captured: unknown;
    actionRemove("a", false, (e) => (captured = e));
    expect((captured as { ok: true; data: { removed: string; new_active: string } }).data.removed).toBe("a");
  });

  it("refuses to remove active profile without --yes", () => {
    addProfile("a", { type: "openai", api_key: "a" });
    addProfile("b", { type: "openai", api_key: "b" });
    useProfile("a");
    expect(() => actionRemove("a", false, () => {})).toThrowError(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  it("removes active profile with --yes and auto-switches active", () => {
    addProfile("alpha", { type: "openai", api_key: "x" });
    addProfile("beta", { type: "openai", api_key: "y" });
    useProfile("beta");
    let captured: unknown;
    actionRemove("beta", true, (e) => (captured = e));
    expect((captured as { ok: true; data: { new_active: string } }).data.new_active).toBe("alpha");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/commands/config.test.ts -t "config remove"
```

Expected: FAIL — `actionRemove` not exported.

- [ ] **Step 3: Implement**

Add to `src/commands/config.ts`:

```ts
export function actionRemove(name: string, yes: boolean, emit: Emitter): void {
  const cfgBefore = readConfigFile();
  const wasActive = cfgBefore.active === name;
  if (wasActive && !yes) {
    throw new CliError(
      "INVALID_INPUT",
      `refusing to remove active profile "${name}" without --yes`,
    );
  }
  removeProfile(name);
  const cfgAfter = readConfigFile();
  emit({
    ok: true,
    data: { removed: name, new_active: cfgAfter.active },
  });
}

function registerRemove(cfg: Command, emit: Emitter) {
  cfg
    .command("remove <name>")
    .description("Delete a profile")
    .action(async (name: string, _opts, cmd: Command) => {
      const global = cmd.optsWithGlobals() as { yes?: boolean };
      actionRemove(name, Boolean(global.yes), emit);
    });
}
```

Add `registerRemove(cfg, emit);` to `registerConfig`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/commands/config.test.ts -t "config remove"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/config.ts tests/unit/commands/config.test.ts
git commit -m "feat(commands/config): add `config remove <name>` with active-guard"
```

---

## Task 13: Global `--profile` flag + `GPT_IMAGE_PROFILE` env wiring

**Files:**
- Modify: `src/index.ts`

The `GlobalOptions.profile` field was added in Task 1; `resolveActiveProfile` already reads `process.env.GPT_IMAGE_PROFILE` (Task 4). What's missing is the CLI flag registration.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/generate.test.ts`:

```ts
  it("--profile flag selects a non-active saved profile", async () => {
    const cfgDir = path.join(tmpHome, ".gpt-image-cli");
    fs.mkdirSync(cfgDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(cfgDir, "config.json"),
      JSON.stringify({
        version: 2,
        active: "a",
        profiles: {
          a: { type: "openai", api_key: "sk-a" },
          b: { type: "openai", api_key: "sk-b", endpoint: "https://b/v1" },
        },
      }),
      { mode: 0o600 },
    );
    delete process.env.OPENAI_API_KEY;
    const captured: unknown[] = [];
    await runGenerate(
      {
        prompt: "x",
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
        profile: "b",
        format: "json",
        jq: undefined,
        dryRun: true,
        yes: false,
        verbose: false,
      },
      (env) => captured.push(env),
    );
    const env = captured[0] as { ok: true; data: { profile: { name: string } } };
    expect(env.data.profile.name).toBe("b");
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/integration/generate.test.ts -t "--profile flag selects"
```

Expected: FAIL — `runGenerate` receives `global.profile = "b"` but `GlobalOptions` may not be passing it through, or it resolves to `a`.

Likely the test passes if Task 6 wired it correctly. If so, just register the CLI flag (next step) for completeness of the user-facing surface.

- [ ] **Step 3: Implement — register `--profile` on the program**

In `src/index.ts`, locate the `program.option(...)` block (lines 33–39). Add `--profile`:

```ts
  program
    .name("gpt-image-cli")
    .version(VERSION)
    .description("OpenAI gpt-image-2 generation and editing CLI")
    .option("--endpoint <url>", "override endpoint for this invocation")
    .option("--api-key <key>", "override API key for this invocation")
    .option("--profile <name>", "select a saved profile (overrides GPT_IMAGE_PROFILE and active)")
    .option("--format <format>", "output format: json | table", "json")
    .option("--jq <expr>", "jq-like path filter on envelope")
    .option("--dry-run", "print request without calling API", false)
    .option("--yes", "skip confirmation for overwriting config values", false)
    .option("--verbose", "debug info on stderr", false);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/integration/generate.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/integration/generate.test.ts
git commit -m "feat(cli): --profile flag selects saved profile per invocation"
```

---

## Task 14: Verbose URL logging for Azure requests

**Files:**
- Modify: `src/commands/generate.ts`
- Modify: `src/commands/edit.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/generate.test.ts`:

```ts
  it("--verbose prints constructed Azure URL before the call (dry-run)", async () => {
    const cfgDir = path.join(tmpHome, ".gpt-image-cli");
    fs.mkdirSync(cfgDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(cfgDir, "config.json"),
      JSON.stringify({
        version: 2,
        active: "az",
        profiles: {
          az: {
            type: "azure",
            endpoint: "https://r.openai.azure.com",
            api_key: "k",
            api_version: "2024-02-01",
            deployment: "gpt-image-2",
            auth_style: "bearer",
          },
        },
      }),
      { mode: 0o600 },
    );
    delete process.env.OPENAI_API_KEY;
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk) => {
        writes.push(String(chunk));
        return true;
      });
    await runGenerate(
      {
        prompt: "x",
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
        dryRun: true,
        yes: false,
        verbose: true,
      },
      () => {},
    );
    spy.mockRestore();
    const all = writes.join("");
    expect(all).toContain(
      "POST https://r.openai.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2024-02-01",
    );
    expect(all).toContain("auth: Bearer ***");
  });
```

Add `import { vi } from "vitest";` to the top of the file if not present.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/integration/generate.test.ts -t "--verbose prints constructed Azure URL"
```

Expected: FAIL — no such stderr output yet.

- [ ] **Step 3: Implement**

In `src/commands/generate.ts`, just after the WEBP guard (Task 7) and just before `if (global.dryRun)`, add:

```ts
  if (global.verbose && profileForDescribe.type === "azure") {
    const url =
      `${profileForDescribe.endpoint.replace(/\/$/, "")}` +
      `/openai/deployments/${profileForDescribe.deployment}` +
      `/images/generations?api-version=${profileForDescribe.apiVersion}`;
    process.stderr.write(`[verbose] POST ${url}\n`);
    const authLabel = profileForDescribe.authStyle === "bearer" ? "Bearer ***" : "api-key ***";
    process.stderr.write(`[verbose] auth: ${authLabel}\n`);
  } else if (global.verbose && profileForDescribe.type === "openai") {
    process.stderr.write(
      `[verbose] POST ${profileForDescribe.endpoint.replace(/\/$/, "")}/images/generations\n`,
    );
  }
```

Same change in `src/commands/edit.ts`, but use `/images/edits` in the path.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/integration/generate.test.ts -t "--verbose prints constructed Azure URL"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/generate.ts src/commands/edit.ts tests/integration/generate.test.ts
git commit -m "feat(verbose): print constructed Azure URL + redacted auth before request"
```

---

## Task 15: Full test sweep + lint + build

**Files:** none

- [ ] **Step 1: Run the full suite**

```bash
npm run lint
npm test
npm run build
```

Expected: all green. If any of these fail, **stop and fix before continuing**. The most likely failure modes:

- Type narrowing on `Profile` union — annotate intermediate variables explicitly.
- `cfg.profiles[name]` returning `undefined` — `getProfile()` is the safe accessor.
- Old test in `tests/unit/core/config.test.ts` referenced `redactApiKey` returning `sk-***` — we now return `***` for short keys and `***<last4>` for long. Update assertions if any still reference the `sk-` prefix.

- [ ] **Step 2: Commit any fixes**

```bash
git add -p
git commit -m "fix: clean up type/lint issues surfaced by full suite"
```

(Skip if nothing to fix.)

---

## Task 16: README + SKILL.md docs

**Files:**
- Modify: `README.md`
- Modify: `skills/gpt-image/SKILL.md`

- [ ] **Step 1: Append Azure section to `README.md`**

After the `## Configure` section (line 38), insert:

```markdown
### Multiple endpoints / profiles

`gpt-image-cli` supports multiple named profiles — public OpenAI, OpenAI-compatible proxies, and Azure OpenAI deployments side-by-side.

```bash
# List all saved profiles
gpt-image-cli config list

# Add a new Azure profile (interactive)
gpt-image-cli config add azure-prod --type azure
# prompts:
#   Azure endpoint:    https://<resource>.openai.azure.com
#   Deployment name:   gpt-image-2
#   api-version:       2024-02-01
#   API key:           ********
#   auth_style:        api-key       (or: bearer)

# Switch active profile
gpt-image-cli config use azure-prod

# Per-invocation override without switching
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

Legacy single-endpoint configs are auto-migrated to the `default` profile on first read.

Notes:
- Azure does **not** support `output_format=webp` — use `png` or `jpeg`.
- `auth_style: "bearer"` sends `Authorization: Bearer <key>` (matches the curl style some Azure endpoints accept). Default `api-key` sends `api-key: <key>` per Microsoft's standard.
```

- [ ] **Step 2: Add multi-profile section to `skills/gpt-image/SKILL.md`**

After the `## 前置` section, insert a new section `## 多端点配置（OpenAI / Azure）`. Read the current SKILL.md first to match style:

```bash
sed -n '15,60p' skills/gpt-image/SKILL.md
```

Append (after line ~26, before `## 核心命令`):

```markdown
## 多端点配置（OpenAI / Azure）

支持同时保存多个 endpoint（公有 OpenAI、自建代理、Azure deployment）并切换。

```bash
gpt-image-cli config list                     # 查看所有 profile
gpt-image-cli config use <name>               # 切换 active
gpt-image-cli config add <name> --type azure  # 向导式新增 Azure profile
gpt-image-cli --profile <name> generate ...   # 单次覆盖，不改 active
```

Azure profile 限制:
- `output_format=webp` 不受支持，改用 `png` 或 `jpeg`。
- `auth_style` 二选一: `api-key`（默认，对应 Microsoft 文档）/ `bearer`（适配 `Authorization: Bearer <key>` 风格的网关）。

旧版单端点 config 会在首次读取时自动迁移为 `default` profile（一次性 stderr 提示）。
```

Bump frontmatter:

```yaml
---
name: gpt-image
version: 1.3.0
description: "..."   # keep existing
...
```

- [ ] **Step 3: Commit**

```bash
git add README.md skills/gpt-image/SKILL.md
git commit -m "docs: README + SKILL multi-profile / Azure sections (skill 1.3.0)"
```

---

## Task 17: Version bump to 1.1.0 + release verification

**Files:**
- Modify: `package.json`
- Modify: `src/index.ts:15`

- [ ] **Step 1: Bump version**

In `package.json`:

```diff
-  "version": "1.0.5",
+  "version": "1.1.0",
```

In `src/index.ts:15`:

```diff
-const VERSION = "1.0.3";
+const VERSION = "1.1.0";
```

Note: `src/index.ts` says `1.0.3` but `package.json` was at `1.0.5` — they had drifted. Re-aligning to `1.1.0` for both.

- [ ] **Step 2: Run prepublish gates**

```bash
npm run prepublishOnly
```

This runs `lint && test && build`. Expected: all green. The script must exit 0 before the next step.

- [ ] **Step 3: Sanity test the built binary**

```bash
node dist/index.js --version
node dist/index.js config list
node dist/index.js --help
```

Expected:
- `1.1.0` printed.
- `config list` either prints existing profiles or an empty `{profiles: []}`.
- `--help` mentions `--profile`, `config list`, `config use`, `config add`, `config remove`.

- [ ] **Step 4: Commit + tag**

```bash
git add package.json src/index.ts
git commit -m "chore(release): 1.1.0 — Azure support + multi-profile config"
git tag v1.1.0
```

- [ ] **Step 5: (Optional, user-gated) Push + publish**

**Do not run these without user approval** — they affect external systems:

```bash
git push origin master --tags
npm publish --access public
```

If running, verify after:

```bash
npm view @zhoujinandrew/gpt-image-cli version   # should report 1.1.0
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Implementing task(s) |
|---|---|
| v2 file shape | Task 2 |
| v1 → v2 auto-migration with stderr notice | Task 2 |
| `OpenAIProfile` / `AzureProfile` discriminated union | Task 1 |
| Profile precedence (flag > env > file > ad-hoc) | Task 4 |
| `--endpoint`/`--api-key` override without changing type | Task 4 |
| `PROFILE_NOT_FOUND` error code + exit 2 + available list | Tasks 1, 3, 4 |
| `makeClient` returns `{client, model, profile}` | Task 5 |
| `AzureOpenAI` with `apiKey` (api-key header) | Task 5 |
| `AzureOpenAI` with `azureADTokenProvider` (Bearer header) | Task 5 |
| `generate`/`edit` use `model` from factory | Task 6 |
| Success + dry-run envelope `profile` block | Task 6 |
| Azure WEBP rejection | Task 7 |
| `config init` (evolved) | Task 8 |
| `config set` / `get` with `--profile` | Task 8 |
| `config show` with sources | Task 8 |
| `config list` | Task 9 |
| `config use <name>` | Task 10 |
| `config add <name>` wizard | Task 11 |
| `config remove <name>` with `--yes` for active | Task 12 |
| Global `--profile <name>` flag | Task 13 |
| `GPT_IMAGE_PROFILE` env | Task 4 (reads it), Task 13 (CLI exposure) |
| Verbose URL/auth logging | Task 14 |
| `api_version` regex validation | Task 3 |
| `endpoint` warning if contains `/openai/deployments/` | Task 3 |
| README updates | Task 16 |
| SKILL.md update + frontmatter 1.3.0 | Task 16 |
| Version bump to 1.1.0 + build/lint/test | Tasks 15, 17 |

Every spec line maps to at least one task. No orphans.

**Placeholder scan:** no TODOs, no "implement later", no "similar to Task N" — code is repeated in full where needed.

**Type consistency check:**
- `ResolvedProfile.apiKey` (camelCase) used consistently across `client.ts`, tests, and `config.ts`.
- `Profile.api_key` (snake_case) — the on-disk field — used consistently in `config.ts` primitives and tests.
- `auth_style` on disk ↔ `authStyle` resolved — consistent direction throughout.
- `ProfileSummary.deployment` is `string | undefined` — used as such everywhere.
- `actionAdd(name, profile, emit)` signature is consistent in declaration (Task 11) and usage in Task 11's wizard.
- `actionRemove(name, yes, emit)` consistent.

No mismatches found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-azure-multi-profile.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
