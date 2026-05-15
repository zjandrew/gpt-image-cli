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
