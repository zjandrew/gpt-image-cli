import { describe, it, expect } from "vitest";
import { renderEnvelope, applyJq } from "../../../src/framework/output.js";
import type { OutputEnvelope } from "../../../src/framework/types.js";

describe("renderEnvelope json", () => {
  it("prints envelope as pretty JSON", () => {
    const env: OutputEnvelope = { ok: true, data: { paths: ["a.png"] } };
    expect(renderEnvelope(env, { format: "json" })).toBe(
      JSON.stringify(env, null, 2),
    );
  });
});

describe("renderEnvelope table", () => {
  it("renders success envelope as table", () => {
    const env: OutputEnvelope = {
      ok: true,
      data: {
        model: "gpt-image-2",
        operation: "generate",
        paths: ["a.png"],
        size: "1024x1024",
        quality: "high",
        output_format: "png",
        count: 1,
      },
    };
    const out = renderEnvelope(env, { format: "table" });
    expect(out).toContain("paths");
    expect(out).toContain("a.png");
    expect(out).toContain("1024x1024");
  });

  it("falls back to JSON on error envelope", () => {
    const env: OutputEnvelope = {
      ok: false,
      error: { code: "INVALID_INPUT", message: "bad prompt" },
    };
    const out = renderEnvelope(env, { format: "table" });
    expect(out).toContain('"INVALID_INPUT"');
  });
});

describe("applyJq", () => {
  it("returns input unchanged when expr is empty", () => {
    const env = { ok: true, data: { x: 1 } };
    expect(applyJq(env, undefined)).toEqual(env);
  });

  it("extracts a single field", () => {
    const env = { ok: true, data: { paths: ["a.png", "b.png"] } };
    expect(applyJq(env, ".data.paths[0]")).toBe("a.png");
  });

  it("throws on invalid expr", () => {
    expect(() => applyJq({ ok: true }, "bogus[[")).toThrow();
  });
});
