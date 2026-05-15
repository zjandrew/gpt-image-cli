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
    const token = await (bundle.client as AzureOpenAI)._getAzureADToken();
    expect(token).toBe("k-bearer");
  });

  it("CONFIG_MISSING when nothing resolves", () => {
    expect(() => makeClient({})).toThrow(/CONFIG_MISSING|API key not set/);
  });
});
