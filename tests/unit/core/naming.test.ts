import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveOutputPaths, timestamp } from "../../../src/core/naming.js";

describe("timestamp", () => {
  it("produces YYYYMMDD-HHmmss format", () => {
    const ts = timestamp(new Date("2026-04-23T15:30:12"));
    expect(ts).toBe("20260423-153012");
  });
});

describe("resolveOutputPaths", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "naming-test-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("n=1, no --out → cwd with timestamp", () => {
    const paths = resolveOutputPaths({
      out: undefined,
      count: 1,
      ext: "png",
      cwd: dir,
      now: new Date("2026-04-23T15:30:12"),
    });
    expect(paths).toHaveLength(1);
    expect(paths[0]!).toMatch(new RegExp(`^${dir}/gpt-image-20260423-153012(?:-[a-f0-9]{2})?\\.png$`));
  });

  it("n=1, --out is a file path → use it directly", () => {
    const out = path.join(dir, "foo.png");
    const paths = resolveOutputPaths({
      out,
      count: 1,
      ext: "png",
      cwd: dir,
      now: new Date(),
    });
    expect(paths).toEqual([out]);
  });

  it("n=1, --out is existing directory → auto-name in that dir", () => {
    const paths = resolveOutputPaths({
      out: dir,
      count: 1,
      ext: "png",
      cwd: process.cwd(),
      now: new Date("2026-04-23T15:30:12"),
    });
    expect(paths[0]!.startsWith(dir + "/gpt-image-20260423-153012")).toBe(true);
  });

  it("n=3, --out file path → suffix -0, -1, -2", () => {
    const out = path.join(dir, "base.png");
    const paths = resolveOutputPaths({
      out,
      count: 3,
      ext: "png",
      cwd: dir,
      now: new Date(),
    });
    expect(paths).toEqual([
      path.join(dir, "base-0.png"),
      path.join(dir, "base-1.png"),
      path.join(dir, "base-2.png"),
    ]);
  });

  it("n=3, --out dir → timestamped with -0/-1/-2 suffix", () => {
    const paths = resolveOutputPaths({
      out: dir,
      count: 3,
      ext: "png",
      cwd: process.cwd(),
      now: new Date("2026-04-23T15:30:12"),
    });
    expect(paths).toHaveLength(3);
    expect(paths[0]!).toMatch(new RegExp(`${dir}/gpt-image-20260423-153012-0\\.png$`));
    expect(paths[2]!).toMatch(new RegExp(`${dir}/gpt-image-20260423-153012-2\\.png$`));
  });

  it("same-second collision → appends random 2-hex suffix", () => {
    fs.writeFileSync(path.join(dir, "gpt-image-20260423-153012.png"), "x");
    const paths = resolveOutputPaths({
      out: undefined,
      count: 1,
      ext: "png",
      cwd: dir,
      now: new Date("2026-04-23T15:30:12"),
    });
    expect(paths[0]!).toMatch(new RegExp(`${dir}/gpt-image-20260423-153012-[a-f0-9]{2}\\.png$`));
  });
});
