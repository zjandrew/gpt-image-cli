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
    // @ts-ignore — v1 shape; intentionally failing test replaced in Task 4
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
    // @ts-ignore — v1 shape; intentionally failing test replaced in Task 4
    writeConfigFile({ api_key: "from-file" });
    process.env.OPENAI_API_KEY = "from-env";
    const r = resolveConfig({});
    expect(r.config.apiKey).toBe("from-env");
    expect(r.sources.apiKey).toBe("env");
  });

  it("file is used when flag+env absent", () => {
    // @ts-ignore — v1 shape; intentionally failing test replaced in Task 4
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
    // @ts-ignore — v1 shape; intentionally failing test replaced in Task 4
    writeConfigFile({ api_key: "k", endpoint: "e" });
    const read = readConfigFile();
    expect(read).toEqual({ api_key: "k", endpoint: "e" });
  });

  it("returns empty object when file does not exist", () => {
    expect(readConfigFile()).toEqual({});
  });

  it("sets 0600 permissions on file", () => {
    // @ts-ignore — v1 shape; intentionally failing test replaced in Task 4
    writeConfigFile({ api_key: "k" });
    const stat = fs.statSync(configFilePath());
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("omits empty string fields", () => {
    // @ts-ignore — v1 shape; intentionally failing test replaced in Task 4
    writeConfigFile({ api_key: "", endpoint: "e" });
    expect(readConfigFile()).toEqual({ endpoint: "e" });
  });
});

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
