import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  readConfigFile,
  configFilePath,
} from "../../../src/core/config.js";

describe("v1 → v2 migration", () => {
  let tmpHome: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: ReturnType<typeof vi.spyOn<any, any>>;
  const origEnv = { ...process.env };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-image-cli-mig-"));
    process.env.HOME = tmpHome;
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
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
    readConfigFile();
    readConfigFile(); // second read — file is already v2, should NOT print again
    const calls = stderrSpy.mock.calls.flat().join("");
    const occurrences = (calls.match(/migrated legacy config to v2/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("returns empty v2 skeleton when file does not exist", () => {
    const cfg = readConfigFile();
    expect(cfg).toEqual({ version: 2, active: null, profiles: {} });
  });
});
