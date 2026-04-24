// src/commands/generate.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { makeClient } from "../core/client.js";
import { itemToBuffer, looksLikeHtml, truncate } from "../core/image-response.js";
import { ensureParentDir, resolveOutputPaths } from "../core/naming.js";
import { CliError, translateOpenAIError } from "../framework/errors.js";
import type {
  Emitter,
  GlobalOptions,
  ImageOpResultData,
} from "../framework/types.js";

export interface GenerateOptions {
  prompt: string;
  count: number;
  size: string;
  quality: string;
  background: string;
  outputFormat: string;
  compression?: number;
  moderation?: string;
  out?: string;
  stdoutBase64: boolean;
}

const QUALITY_VALUES = new Set(["low", "medium", "high", "auto"]);
const BG_VALUES = new Set(["transparent", "opaque", "auto"]);
const FMT_VALUES = new Set(["png", "jpeg", "webp"]);
const MOD_VALUES = new Set(["auto", "low"]);

const SIZE_MIN_PIXELS = 655_360;
const SIZE_MAX_PIXELS = 8_294_400;
const SIZE_MAX_SIDE = 3840;
const SIZE_MIN_SIDE = 256;

function validateSize(size: string): void {
  if (size === "auto") return;
  const m = /^(\d+)x(\d+)$/.exec(size);
  if (!m) {
    throw new CliError(
      "INVALID_INPUT",
      `size must be "auto" or <width>x<height>, got: ${size}`,
    );
  }
  const w = parseInt(m[1]!, 10);
  const h = parseInt(m[2]!, 10);
  if (w % 16 !== 0 || h % 16 !== 0) {
    throw new CliError(
      "INVALID_INPUT",
      `size dimensions must be multiples of 16, got: ${size}`,
    );
  }
  if (w < SIZE_MIN_SIDE || h < SIZE_MIN_SIDE) {
    throw new CliError(
      "INVALID_INPUT",
      `size dimensions must be at least ${SIZE_MIN_SIDE}px, got: ${size}`,
    );
  }
  if (w > SIZE_MAX_SIDE || h > SIZE_MAX_SIDE) {
    throw new CliError(
      "INVALID_INPUT",
      `size dimensions must be at most ${SIZE_MAX_SIDE}px, got: ${size}`,
    );
  }
  const pixels = w * h;
  if (pixels < SIZE_MIN_PIXELS || pixels > SIZE_MAX_PIXELS) {
    throw new CliError(
      "INVALID_INPUT",
      `total pixels must be ${SIZE_MIN_PIXELS}-${SIZE_MAX_PIXELS}, got: ${pixels}`,
    );
  }
  const ratio = Math.max(w, h) / Math.min(w, h);
  if (ratio > 3) {
    throw new CliError(
      "INVALID_INPUT",
      `aspect ratio must be between 3:1 and 1:3, got: ${size} (ratio ${ratio.toFixed(2)})`,
    );
  }
}

export function validateGenerateOptions(opts: GenerateOptions): void {
  if (!opts.prompt || opts.prompt.trim() === "") {
    throw new CliError("INVALID_INPUT", "prompt must be non-empty");
  }
  if (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > 10) {
    throw new CliError("INVALID_INPUT", "count must be an integer in [1,10]");
  }
  validateSize(opts.size);
  if (!QUALITY_VALUES.has(opts.quality)) {
    throw new CliError("INVALID_INPUT", `quality must be one of: ${[...QUALITY_VALUES].join(", ")}`);
  }
  if (!BG_VALUES.has(opts.background)) {
    throw new CliError("INVALID_INPUT", `background must be one of: ${[...BG_VALUES].join(", ")}`);
  }
  if (!FMT_VALUES.has(opts.outputFormat)) {
    throw new CliError("INVALID_INPUT", `output-format must be one of: ${[...FMT_VALUES].join(", ")}`);
  }
  if (opts.moderation && !MOD_VALUES.has(opts.moderation)) {
    throw new CliError("INVALID_INPUT", `moderation must be one of: ${[...MOD_VALUES].join(", ")}`);
  }
  if (opts.compression !== undefined) {
    if (opts.outputFormat === "png") {
      throw new CliError("INVALID_INPUT", "--compression is only valid for jpeg/webp");
    }
    if (opts.compression < 0 || opts.compression > 100 || !Number.isInteger(opts.compression)) {
      throw new CliError("INVALID_INPUT", "compression must be integer in [0,100]");
    }
  }
  if (opts.background === "transparent" && opts.outputFormat === "jpeg") {
    throw new CliError("INVALID_INPUT", "transparent background requires png or webp");
  }
}

export async function runGenerate(
  opts: GenerateOptions,
  global: GlobalOptions,
  emit: Emitter,
): Promise<void> {
  validateGenerateOptions(opts);
  const emitOpts = { toStderr: opts.stdoutBase64 };

  const prompt =
    opts.prompt === "-"
      ? fs.readFileSync(0, "utf8").trim()
      : opts.prompt;
  if (!prompt) throw new CliError("INVALID_INPUT", "prompt from stdin was empty");

  const request: Record<string, unknown> = {
    model: "gpt-image-2",
    prompt,
    n: opts.count,
    size: opts.size,
    quality: opts.quality,
    background: opts.background,
    output_format: opts.outputFormat,
  };
  if (opts.compression !== undefined) request.output_compression = opts.compression;
  if (opts.moderation) request.moderation = opts.moderation;

  if (global.dryRun) {
    emit(
      {
        ok: true,
        data: { operation: "generate", request },
      },
      emitOpts,
    );
    return;
  }

  const client = makeClient({ apiKey: global.apiKey, endpoint: global.endpoint });

  let response;
  try {
    response = await client.images.generate(request as unknown as Parameters<typeof client.images.generate>[0]);
  } catch (err) {
    throw translateOpenAIError(err);
  }

  if (global.verbose) {
    const preview = truncate(JSON.stringify(response), 800);
    process.stderr.write(`[verbose] response: ${preview}\n`);
  }

  const items = (response.data ?? []) as Array<{ b64_json?: string; url?: string }>;
  if (items.length === 0) {
    if (looksLikeHtml(response)) {
      throw new CliError(
        "OPENAI_API_ERROR",
        "endpoint returned HTML instead of JSON — check that --endpoint includes the API path (e.g. `https://your-proxy/v1`, not `https://your-proxy`)",
        { response_preview: truncate(JSON.stringify(response), 400) },
      );
    }
    throw new CliError("OPENAI_API_ERROR", "response contained no images", {
      response_keys: Object.keys(response ?? {}),
      response_preview: truncate(JSON.stringify(response), 500),
    });
  }

  const paths = resolveOutputPaths({
    out: opts.out,
    count: items.length,
    ext: opts.outputFormat,
    cwd: process.cwd(),
  });

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const buf = await itemToBuffer(item, i);
    const outPath = paths[i]!;
    ensureParentDir(outPath);
    try {
      fs.writeFileSync(outPath, buf);
    } catch (err) {
      const e = err as { message?: string };
      throw new CliError("IO_ERROR", `failed to write ${outPath}: ${e.message}`);
    }
    if (opts.stdoutBase64) process.stdout.write(buf.toString("base64") + "\n");
  }

  const data: ImageOpResultData = {
    model: "gpt-image-2",
    operation: "generate",
    paths,
    size: opts.size,
    quality: opts.quality,
    output_format: opts.outputFormat,
    count: items.length,
    usage: (response as unknown as { usage?: ImageOpResultData["usage"] }).usage,
  };
  emit({ ok: true, data }, emitOpts);
}

export function registerGenerate(
  program: Command,
  emit: Emitter,
): void {
  program
    .command("generate")
    .description("Generate image(s) from a prompt")
    .requiredOption("-p, --prompt <text>", "prompt (use '-' to read stdin)")
    .option("-n, --count <int>", "number of images (1-10)", (v) => parseInt(v, 10), 1)
    .option("-s, --size <wxh>", "image size", "auto")
    .option("-q, --quality <level>", "quality: low/medium/high/auto", "auto")
    .option("-b, --background <mode>", "background: transparent/opaque/auto", "auto")
    .option("-f, --output-format <fmt>", "output format: png/jpeg/webp", "png")
    .option("--compression <int>", "jpeg/webp compression 0-100", (v) => parseInt(v, 10))
    .option("--moderation <level>", "moderation: auto/low")
    .option("--out <path>", "output file or directory")
    .option("--stdout-base64", "print base64 to stdout (envelope goes to stderr)", false)
    .action(async (opts: GenerateOptions, cmd: Command) => {
      const global = cmd.optsWithGlobals() as unknown as GlobalOptions;
      await runGenerate(opts, global, emit);
    });
}
