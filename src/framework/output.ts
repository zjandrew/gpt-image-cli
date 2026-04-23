import Table from "cli-table3";
import type { OutputEnvelope } from "./types.js";

export interface RenderOptions {
  format: "json" | "table";
}

export function renderEnvelope(env: OutputEnvelope, opts: RenderOptions): string {
  if (opts.format === "table" && env.ok) {
    return renderTable(env.data as Record<string, unknown>);
  }
  return JSON.stringify(env, null, 2);
}

function renderTable(data: Record<string, unknown>): string {
  const table = new Table({ head: ["field", "value"] });
  for (const [k, v] of Object.entries(data)) {
    table.push([k, formatValue(v)]);
  }
  return table.toString();
}

function formatValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => String(x)).join("\n");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Tiny jq-subset: supports `.a.b[0].c` style paths. No filters, pipes, or
// functions — this is deliberately minimal. Throws on syntax errors.
export function applyJq(value: unknown, expr: string | undefined): unknown {
  if (!expr) return value;
  const path = parseJqPath(expr);
  let cur: unknown = value;
  for (const seg of path) {
    if (cur == null) return null;
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) throw new Error(`jq: expected array at ${expr}`);
      cur = cur[seg];
    } else {
      if (typeof cur !== "object") throw new Error(`jq: expected object at ${expr}`);
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

type JqSegment = string | number;

function parseJqPath(expr: string): JqSegment[] {
  const trimmed = expr.trim();
  if (trimmed === "." || trimmed === "") return [];
  if (!trimmed.startsWith(".")) throw new Error(`jq: expression must start with '.': ${expr}`);
  const segments: JqSegment[] = [];
  // Match .name or [int]
  const re = /\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    if (m.index !== idx) throw new Error(`jq: parse error near '${trimmed.slice(idx)}'`);
    if (m[1] !== undefined) segments.push(m[1]);
    else if (m[2] !== undefined) segments.push(parseInt(m[2], 10));
    idx = re.lastIndex;
  }
  if (idx !== trimmed.length) throw new Error(`jq: parse error near '${trimmed.slice(idx)}'`);
  return segments;
}
