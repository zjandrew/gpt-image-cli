// src/commands/generate.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { makeClient } from "../core/client.js";
import { resolveOutputPaths } from "../core/naming.js";
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

const SIZE_VALUES = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
const QUALITY_VALUES = new Set(["low", "medium", "high", "auto"]);
const BG_VALUES = new Set(["transparent", "opaque", "auto"]);
const FMT_VALUES = new Set(["png", "jpeg", "webp"]);
const MOD_VALUES = new Set(["auto", "low"]);

export function validateGenerateOptions(opts: GenerateOptions): void {
  if (!opts.prompt || opts.prompt.trim() === "") {
    throw new CliError("INVALID_INPUT", "prompt must be non-empty");
  }
  if (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > 10) {
    throw new CliError("INVALID_INPUT", "count must be an integer in [1,10]");
  }
  if (!SIZE_VALUES.has(opts.size)) {
    throw new CliError("INVALID_INPUT", `size must be one of: ${[...SIZE_VALUES].join(", ")}`);
  }
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

  const items = (response.data ?? []) as Array<{ b64_json?: string }>;
  if (items.length === 0) {
    throw new CliError("OPENAI_API_ERROR", "response contained no images");
  }

  const paths = resolveOutputPaths({
    out: opts.out,
    count: items.length,
    ext: opts.outputFormat,
    cwd: process.cwd(),
  });

  for (let i = 0; i < items.length; i++) {
    const b64 = items[i]!.b64_json;
    if (!b64) throw new CliError("OPENAI_API_ERROR", `item ${i} has no b64_json`);
    const outPath = paths[i]!;
    ensureParentDir(outPath);
    try {
      fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
    } catch (err) {
      const e = err as { message?: string };
      throw new CliError("IO_ERROR", `failed to write ${outPath}: ${e.message}`);
    }
    if (opts.stdoutBase64) process.stdout.write(b64 + "\n");
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

function ensureParentDir(p: string): void {
  const dir = path.dirname(p);
  if (dir && dir !== "." && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
