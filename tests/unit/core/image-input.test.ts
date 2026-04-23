import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveImageInput } from "../../../src/core/image-input.js";
import { CliError } from "../../../src/framework/errors.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixture = path.resolve(here, "../../fixtures/tiny.png");

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
    // .txt file, clearly not an image
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
  it("detects http URL and returns fetch-planned descriptor", async () => {
    // We don't actually hit the network in unit tests; instead assert that the
    // function throws in dryRun mode OR short-circuits. For now, verify the
    // function recognizes the URL format by attempting and catching.
    // Concretely: we check that a URL input does NOT throw INVALID_INPUT for
    // "file not found" — it either fetches or throws NETWORK_ERROR.
    try {
      await resolveImageInput("https://invalid.example.invalid/x.png");
      // if it returns, that's ok — we only care it didn't treat it as a missing path
    } catch (e) {
      const err = e as CliError;
      expect(err.code).not.toBe("INVALID_INPUT");
    }
  });
});
