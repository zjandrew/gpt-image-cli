// tests/unit/core/image-input.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveImageInput } from "../../../src/core/image-input.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixture = path.resolve(here, "../../fixtures/tiny.png");

// Tiny 1x1 PNG as raw bytes (same content as fixture), used for URL responses.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const server = setupServer(
  http.get("https://img.example.test/ok.png", () =>
    HttpResponse.arrayBuffer(
      PNG_BYTES.buffer.slice(
        PNG_BYTES.byteOffset,
        PNG_BYTES.byteOffset + PNG_BYTES.byteLength,
      ) as ArrayBuffer,
      { headers: { "content-type": "image/png" } },
    ),
  ),
  http.get("https://img.example.test/bad.html", () =>
    HttpResponse.text("<html/>", {
      headers: { "content-type": "text/html" },
    }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

describe("resolveImageInput — local path", () => {
  it("reads the file and returns buffer + mime + filename", async () => {
    const res = await resolveImageInput(fixture);
    expect(res.mime).toBe("image/png");
    expect(res.filename).toBe("tiny.png");
    expect(res.buffer.length).toBeGreaterThan(0);
  });

  it("throws INVALID_INPUT when file missing", async () => {
    await expect(resolveImageInput("./nope.png")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("throws INVALID_INPUT for unsupported MIME", async () => {
    const tmp = path.resolve(here, "../../fixtures/not-an-image.txt");
    const fs = await import("node:fs");
    fs.writeFileSync(tmp, "hello");
    await expect(resolveImageInput(tmp)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    fs.unlinkSync(tmp);
  });
});

describe("resolveImageInput — URL", () => {
  it("fetches http(s) URL and returns buffer + mime + filename", async () => {
    const res = await resolveImageInput("https://img.example.test/ok.png");
    expect(res.mime).toBe("image/png");
    expect(res.filename).toBe("ok.png");
    expect(res.buffer.length).toBeGreaterThan(0);
  });

  it("throws INVALID_INPUT when URL returns unsupported MIME", async () => {
    await expect(
      resolveImageInput("https://img.example.test/bad.html"),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
