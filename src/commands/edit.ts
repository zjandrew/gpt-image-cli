// src/commands/edit.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { toFile } from "openai";
import { makeClient } from "../core/client.js";
import { resolveImageInput } from "../core/image-input.js";
import { resolveOutputPaths } from "../core/naming.js";
import { CliError, translateOpenAIError } from "../framework/errors.js";
import type {
  Emitter,
  GlobalOptions,
  ImageOpResultData,
} from "../framework/types.js";
import { validateGenerateOptions } from "./generate.js";

export interface EditOptions {
  prompt: string;
  images: string[];
  mask?: string;
  inputFidelity: string;
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

const FIDELITY_VALUES = new Set(["low", "high"]);

function validateEditOptions(opts: EditOptions): void {
  validateGenerateOptions({
    prompt: opts.prompt,
    count: opts.count,
    size: opts.size,
    quality: opts.quality,
    background: opts.background,
    outputFormat: opts.outputFormat,
    compression: opts.compression,
    moderation: opts.moderation,
    stdoutBase64: opts.stdoutBase64,
    out: opts.out,
  });
  if (!opts.images || opts.images.length === 0) {
    throw new CliError("INVALID_INPUT", "--image is required (at least one)");
  }
  if (!FIDELITY_VALUES.has(opts.inputFidelity)) {
    throw new CliError(
      "INVALID_INPUT",
      `input-fidelity must be one of: ${[...FIDELITY_VALUES].join(", ")}`,
    );
  }
}

export async function runEdit(
  opts: EditOptions,
  global: GlobalOptions,
  emit: Emitter,
): Promise<void> {
  validateEditOptions(opts);
  const emitOpts = { toStderr: opts.stdoutBase64 };

  const prompt =
    opts.prompt === "-" ? fs.readFileSync(0, "utf8").trim() : opts.prompt;
  if (!prompt) throw new CliError("INVALID_INPUT", "prompt from stdin was empty");

  const imageFiles = await Promise.all(
    opts.images.map(async (p) => {
      const r = await resolveImageInput(p);
      return await toFile(r.buffer, r.filename, { type: r.mime });
    }),
  );
  const maskFile = opts.mask
    ? await (async () => {
        const r = await resolveImageInput(opts.mask!);
        return await toFile(r.buffer, r.filename, { type: r.mime });
      })()
    : undefined;

  const request: Record<string, unknown> = {
    model: "gpt-image-2",
    prompt,
    image: imageFiles.length === 1 ? imageFiles[0]! : imageFiles,
    n: opts.count,
    size: opts.size,
    quality: opts.quality,
    background: opts.background,
    output_format: opts.outputFormat,
    input_fidelity: opts.inputFidelity,
  };
  if (maskFile) request.mask = maskFile;
  if (opts.compression !== undefined) request.output_compression = opts.compression;
  if (opts.moderation) request.moderation = opts.moderation;

  if (global.dryRun) {
    emit(
      {
        ok: true,
        data: {
          operation: "edit",
          request: {
            ...request,
            image: `<${imageFiles.length} file(s)>`,
            mask: maskFile ? "<file>" : undefined,
          },
        },
      },
      emitOpts,
    );
    return;
  }

  const client = makeClient({ apiKey: global.apiKey, endpoint: global.endpoint });

  let response;
  try {
    response = await client.images.edit(request as unknown as Parameters<typeof client.images.edit>[0]);
  } catch (err) {
    throw translateOpenAIError(err);
  }

  const items = (response.data ?? []) as Array<{ b64_json?: string }>;
  if (items.length === 0) throw new CliError("OPENAI_API_ERROR", "no images returned");

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
    operation: "edit",
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

export function registerEdit(
  program: Command,
  emit: Emitter,
): void {
  program
    .command("edit")
    .description("Edit image(s) with a prompt and optional mask")
    .requiredOption("-p, --prompt <text>", "prompt (use '-' to read stdin)")
    .requiredOption(
      "--image <path|url>",
      "input image (repeat for multi-image input)",
      (val: string, prev: string[] = []) => [...prev, val],
      [],
    )
    .option("--mask <path|url>", "optional inpainting mask")
    .option("--input-fidelity <level>", "low | high", "low")
    .option("-n, --count <int>", "number of outputs (1-10)", (v) => parseInt(v, 10), 1)
    .option("-s, --size <wxh>", "image size", "auto")
    .option("-q, --quality <level>", "quality", "auto")
    .option("-b, --background <mode>", "background", "auto")
    .option("-f, --output-format <fmt>", "output format", "png")
    .option("--compression <int>", "jpeg/webp compression 0-100", (v) => parseInt(v, 10))
    .option("--moderation <level>", "auto | low")
    .option("--out <path>", "output file or directory")
    .option("--stdout-base64", "print base64 to stdout", false)
    .action(async (raw: Record<string, unknown>, cmd: Command) => {
      const opts: EditOptions = {
        prompt: raw.prompt as string,
        images: (raw.image as string[]) ?? [],
        mask: raw.mask as string | undefined,
        inputFidelity: (raw.inputFidelity as string) ?? "low",
        count: raw.count as number,
        size: raw.size as string,
        quality: raw.quality as string,
        background: raw.background as string,
        outputFormat: raw.outputFormat as string,
        compression: raw.compression as number | undefined,
        moderation: raw.moderation as string | undefined,
        out: raw.out as string | undefined,
        stdoutBase64: Boolean(raw.stdoutBase64),
      };
      const global = cmd.optsWithGlobals() as unknown as GlobalOptions;
      await runEdit(opts, global, emit);
    });
}
