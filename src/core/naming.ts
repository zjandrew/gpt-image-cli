import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export function timestamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

export interface ResolveOutputInput {
  out?: string;
  count: number;
  ext: string;
  cwd: string;
  now?: Date;
}

export function resolveOutputPaths(i: ResolveOutputInput): string[] {
  const now = i.now ?? new Date();
  const ts = timestamp(now);

  let dir: string;
  let baseStem: string | undefined; // undefined → use auto-name with ts

  if (!i.out) {
    dir = i.cwd;
    baseStem = undefined;
  } else if (isExistingDir(i.out) || i.out.endsWith("/")) {
    dir = i.out;
    baseStem = undefined;
  } else {
    dir = path.dirname(i.out) || ".";
    baseStem = path.basename(i.out, path.extname(i.out));
  }

  const paths: string[] = [];
  for (let idx = 0; idx < i.count; idx++) {
    let name: string;
    if (baseStem !== undefined) {
      name = i.count === 1 ? `${baseStem}.${i.ext}` : `${baseStem}-${idx}.${i.ext}`;
    } else {
      const suffix = i.count === 1 ? "" : `-${idx}`;
      name = `gpt-image-${ts}${suffix}.${i.ext}`;
    }
    let full = path.join(dir, name);
    if (fs.existsSync(full)) {
      // Collision → append random hash
      const hash = crypto.randomBytes(1).toString("hex");
      const stem = path.basename(full, path.extname(full));
      full = path.join(dir, `${stem}-${hash}.${i.ext}`);
    }
    paths.push(full);
  }
  return paths;
}

function isExistingDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
