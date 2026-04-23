import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("omits empty string fields", () => {
    writeConfigFile({ api_key: "", endpoint: "e" });
    expect(readConfigFile()).toEqual({ endpoint: "e" });
  });
});
