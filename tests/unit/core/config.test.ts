import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  readConfigFile,
  configFilePath,
  addProfile,
  removeProfile,
  useProfile,
  getProfile,
  listProfiles,
  setProfileField,
} from "../../../src/core/config.js";
import { CliError } from "../../../src/framework/errors.js";

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
