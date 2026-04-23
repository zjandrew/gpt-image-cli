// tests/integration/generate.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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
    expect(body.model).toBe("gpt-image-2");
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
    expect(env.data.model).toBe("gpt-image-2");
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
});
