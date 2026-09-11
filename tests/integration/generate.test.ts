// tests/integration/generate.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runGenerate } from "../../src/commands/generate.js";

// Tiny 1x1 PNG, base64
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const server = setupServer(
  http.post("https://api.openai.com/v1/images/generations", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    expect(body.model).toBe("gpt-image-2.5-flare");
    return HttpResponse.json({
      created: 1,
      data: [{ b64_json: PNG_1X1 }],
      usage: { input_tokens: 10, output_tokens: 1000, total_tokens: 1010 },
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

describe("generate", () => {
  let dir: string;
  let tmpHome: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-test-"));
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "gen-home-"));
    process.env.HOME = tmpHome;
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.OPENAI_BASE_URL;
  });

  it("single image is written and envelope emitted", async () => {
    const captured: unknown[] = [];
    await runGenerate(
      {
        prompt: "a cat",
        count: 1,
        size: "1024x1024",
        quality: "auto",
        background: "auto",
        outputFormat: "png",
        out: path.join(dir, "cat.png"),
        stdoutBase64: false,
      },
      {
        endpoint: undefined,
        apiKey: undefined,
        format: "json",
        jq: undefined,
        dryRun: false,
        yes: false,
        verbose: false,
      },
      (env) => captured.push(env),
    );
    expect(fs.existsSync(path.join(dir, "cat.png"))).toBe(true);
    const env = captured[0] as { ok: boolean; data: { paths: string[]; model: string } };
    expect(env.ok).toBe(true);
    expect(env.data.model).toBe("gpt-image-2.5-flare");
    expect(env.data.paths).toEqual([path.join(dir, "cat.png")]);
  });

  it("dry-run does not call API or write files", async () => {
    const captured: unknown[] = [];
    await runGenerate(
      {
        prompt: "a cat",
        count: 1,
        size: "auto",
        quality: "auto",
        background: "auto",
        outputFormat: "png",
        out: path.join(dir, "cat.png"),
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
    expect(fs.existsSync(path.join(dir, "cat.png"))).toBe(false);
    const env = captured[0] as { ok: boolean; data: { request: unknown } };
    expect(env.ok).toBe(true);
    expect((env.data as { request: unknown }).request).toBeDefined();
  });

  it("rejects INVALID_INPUT when prompt empty", async () => {
    const captured: unknown[] = [];
    await expect(
      runGenerate(
        {
          prompt: "",
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
          dryRun: false,
          yes: false,
          verbose: false,
        },
        (env) => captured.push(env),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects INVALID_INPUT for count > 10", async () => {
    await expect(
      runGenerate(
        {
          prompt: "a",
          count: 11,
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
          dryRun: false,
          yes: false,
          verbose: false,
        },
        () => {},
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

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

  it("rejects WEBP output_format when active profile is azure", async () => {
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

  const baseOpts = {
    prompt: "x",
    count: 1,
    size: "auto",
    quality: "auto",
    background: "auto",
    outputFormat: "png",
    stdoutBase64: false,
  };
  const dryGlobal = {
    endpoint: undefined,
    apiKey: undefined,
    format: "json" as const,
    jq: undefined,
    dryRun: true,
    yes: false,
    verbose: false,
  };

  it("--model overrides the request model for openai profile (dry-run)", async () => {
    const captured: unknown[] = [];
    await runGenerate(baseOpts, { ...dryGlobal, model: "gpt-image-2.5-sunburst" }, (env) => captured.push(env));
    const env = captured[0] as { data: { request: { model: string } } };
    expect(env.data.request.model).toBe("gpt-image-2.5-sunburst");
  });

  it("accepts quality xhigh and max", async () => {
    for (const q of ["xhigh", "max"]) {
      const captured: unknown[] = [];
      await runGenerate({ ...baseOpts, quality: q }, dryGlobal, (env) => captured.push(env));
      const env = captured[0] as { data: { request: { quality: string } } };
      expect(env.data.request.quality).toBe(q);
    }
  });

  it("rejects unknown quality", async () => {
    await expect(
      runGenerate({ ...baseOpts, quality: "ultra" }, dryGlobal, () => {}),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("--model overrides the Azure deployment in the verbose URL (dry-run)", async () => {
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
            deployment: "gpt-image-2.5-flare",
          },
        },
      }),
      { mode: 0o600 },
    );
    delete process.env.OPENAI_API_KEY;
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const captured: unknown[] = [];
    await runGenerate(
      baseOpts,
      { ...dryGlobal, verbose: true, model: "gpt-image-2.5-sunburst" },
      (env) => captured.push(env),
    );
    spy.mockRestore();
    expect(writes.join("")).toContain(
      "/openai/deployments/gpt-image-2.5-sunburst/images/generations?api-version=2024-02-01",
    );
    const env = captured[0] as { data: { request: { model: string }; profile: { deployment: string } } };
    expect(env.data.request.model).toBe("gpt-image-2.5-sunburst");
    expect(env.data.profile.deployment).toBe("gpt-image-2.5-flare");
  });
});
