import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  ConfigSource,
  Profile,
  ProfileType,
  ResolvedProfile,
} from "../framework/types.js";
import { CliError } from "../framework/errors.js";

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
  return (
    r.version === 2 &&
    typeof r.profiles === "object" &&
    r.profiles !== null &&
    !Array.isArray(r.profiles)
  );
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
        { available: Object.keys(file.profiles).sort((a, b) => a.localeCompare(b)) },
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

// ---- Profile CRUD ----

const AZURE_REQUIRED: readonly string[] = [
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
    if (!p.api_key?.trim()) {
      throw new CliError("INVALID_INPUT", "api_key is required");
    }
    return;
  }
  for (const k of AZURE_REQUIRED) {
    const v = (p as unknown as Record<string, unknown>)[k];
    if (typeof v !== "string" || !v.trim()) {
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
  if (!name?.trim()) {
    throw new CliError("INVALID_INPUT", "profile name is required");
  }
  if (name.includes("/")) {
    throw new CliError("INVALID_INPUT", "profile name must not contain '/'");
  }
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
      available: Object.keys(cfg.profiles).sort((a, b) => a.localeCompare(b)),
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
    cfg.active = Object.keys(cfg.profiles).sort((a, b) => a.localeCompare(b))[0]!;
  }
  writeConfigFile(cfg);
}

export function useProfile(name: string): void {
  const cfg = readConfigFile();
  if (!cfg.profiles[name]) {
    throw new CliError("PROFILE_NOT_FOUND", `no such profile: ${name}`, {
      available: Object.keys(cfg.profiles).sort((a, b) => a.localeCompare(b)),
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
      available: Object.keys(cfg.profiles).sort((a, b) => a.localeCompare(b)),
    });
  }
  const allowed = prof.type === "openai" ? ALLOWED_KEYS_OPENAI : ALLOWED_KEYS_AZURE;
  if (!allowed.has(key)) {
    throw new CliError(
      "INVALID_INPUT",
      `key "${key}" not allowed for ${prof.type} profile (allowed: ${[...allowed].join(", ")})`,
    );
  }
  (prof as unknown as Record<string, string>)[key] = value;
  validateProfile(prof);
  writeConfigFile(cfg);
}
