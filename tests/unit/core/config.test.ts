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
  resolveActiveProfile,
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

  it("addProfile rejects whitespace-only api_key", () => {
    expect(() =>
      addProfile("p", { type: "openai", api_key: "   " }),
    ).toThrow(/api_key is required/);
  });

  it("addProfile rejects whitespace-only azure required field", () => {
    expect(() =>
      addProfile("az", {
        type: "azure",
        endpoint: "https://r.openai.azure.com",
        api_key: "k",
        api_version: "  ",
        deployment: "d",
      }),
    ).toThrow(/api_version/);
  });

  it("addProfile rejects empty profile name", () => {
    expect(() =>
      addProfile("", { type: "openai", api_key: "k" }),
    ).toThrow(/name is required/);
  });

  it("addProfile rejects name containing '/'", () => {
    expect(() =>
      addProfile("a/b", { type: "openai", api_key: "k" }),
    ).toThrow(/'\/'/);
  });
});

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
