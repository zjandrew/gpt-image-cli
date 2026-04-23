import * as fs from "node:fs/promises";
import * as path from "node:path";
import mime from "mime";
import { CliError } from "../framework/errors.js";

export interface ResolvedImage {
  buffer: Buffer;
  filename: string;
  mime: string;
}

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function resolveImageInput(input: string): Promise<ResolvedImage> {
  if (/^https?:\/\//i.test(input)) {
    return await fetchUrl(input);
  }
  return await readLocal(input);
}

async function readLocal(p: string): Promise<ResolvedImage> {
  let stat;
  try {
    stat = await fs.stat(p);
  } catch (err) {
    throw new CliError("INVALID_INPUT", `Image file not found: ${p}`);
  }
  if (!stat.isFile()) {
    throw new CliError("INVALID_INPUT", `Not a regular file: ${p}`);
  }
  const buffer = await fs.readFile(p);
  const filename = path.basename(p);
  const m = mime.getType(p) ?? "application/octet-stream";
  if (!ALLOWED_MIME.has(m)) {
    throw new CliError(
      "INVALID_INPUT",
      `Unsupported image MIME: ${m}. Allowed: png/jpeg/webp`,
    );
  }
  return { buffer, filename, mime: m };
}

async function fetchUrl(url: string): Promise<ResolvedImage> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    throw new CliError("NETWORK_ERROR", `Failed to fetch ${url}: ${e.message ?? e.code}`);
  }
  if (!res.ok) {
    throw new CliError(
      "NETWORK_ERROR",
      `Fetch ${url} returned HTTP ${res.status}`,
    );
  }
  const m = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!ALLOWED_MIME.has(m)) {
    throw new CliError(
      "INVALID_INPUT",
      `Unsupported image MIME from URL: ${m || "(none)"}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const filename = path.basename(new URL(url).pathname) || "download";
  return { buffer: buf, filename, mime: m };
}
