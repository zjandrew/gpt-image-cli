import { CliError } from "../framework/errors.js";

export interface ImageResponseItem {
  b64_json?: string;
  url?: string;
}

export async function itemToBuffer(
  item: ImageResponseItem,
  idx: number,
): Promise<Buffer> {
  if (item.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item.url) {
    let res: Response;
    try {
      res = await fetch(item.url);
    } catch (err) {
      const e = err as { message?: string };
      throw new CliError(
        "NETWORK_ERROR",
        `failed to fetch image ${idx} from ${item.url}: ${e.message}`,
      );
    }
    if (!res.ok) {
      throw new CliError(
        "NETWORK_ERROR",
        `fetch ${item.url} returned HTTP ${res.status}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }
  throw new CliError(
    "OPENAI_API_ERROR",
    `item ${idx} has neither b64_json nor url`,
    { item_keys: Object.keys(item) },
  );
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `… (truncated, ${s.length} bytes total)`;
}

/** Detect if a response appears to be an HTML document instead of JSON. */
export function looksLikeHtml(response: unknown): boolean {
  if (typeof response === "string") {
    return /^\s*<!doctype|^\s*<html/i.test(response);
  }
  // SDK may wrap a string response into an object keyed by indices ("0","1",...)
  if (response && typeof response === "object") {
    const keys = Object.keys(response);
    if (keys.length > 20 && keys.every((k) => /^\d+$/.test(k))) {
      const reconstructed = keys
        .slice(0, 200)
        .map((k) => (response as Record<string, unknown>)[k])
        .join("");
      return /^\s*<!doctype|^\s*<html/i.test(reconstructed);
    }
  }
  return false;
}
