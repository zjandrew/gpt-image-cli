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
