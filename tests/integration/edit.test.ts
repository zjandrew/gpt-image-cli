// tests/integration/edit.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runEdit } from "../../src/commands/edit.js";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const server = setupServer(
  http.post("https://api.openai.com/v1/images/edits", async ({ request }) => {
    // Edit endpoint uses multipart/form-data
    const ct = request.headers.get("content-type") ?? "";
    expect(ct).toContain("multipart/form-data");
    return HttpResponse.json({
      created: 1,
      data: [{ b64_json: PNG_1X1 }],
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

describe("edit", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "edit-test-"));
    process.env.OPENAI_API_KEY = "sk-test";
    // copy fixture to dir
    const here = fileURLToPath(new URL(".", import.meta.url));
    const src = path.resolve(here, "../fixtures/tiny.png");
    fs.copyFileSync(src, path.join(dir, "base.png"));
  });

  it("edits a single image and writes output", async () => {
    const captured: unknown[] = [];
    await runEdit(
      {
        prompt: "add a hat",
        images: [path.join(dir, "base.png")],
        mask: undefined,
        inputFidelity: "low",
        count: 1,
        size: "auto",
        quality: "auto",
        background: "auto",
        outputFormat: "png",
        out: path.join(dir, "out.png"),
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
    expect(fs.existsSync(path.join(dir, "out.png"))).toBe(true);
    const env = captured[0] as { ok: boolean; data: { operation: string } };
    expect(env.data.operation).toBe("edit");
  });

  it("rejects when --image missing", async () => {
    await expect(
      runEdit(
        {
          prompt: "x",
          images: [],
          mask: undefined,
          inputFidelity: "low",
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
        () => {},
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
