// src/index.ts
import { Command } from "commander";
import { applyJq, renderEnvelope } from "./framework/output.js";
import { CliError, exitCodeFor, translateOpenAIError } from "./framework/errors.js";
import type {
  Emitter,
  EmitOptions,
  GlobalOptions,
  OutputEnvelope,
} from "./framework/types.js";
import { registerGenerate } from "./commands/generate.js";
import { registerEdit } from "./commands/edit.js";
import { registerConfig } from "./commands/config.js";

const VERSION = "1.0.3";

function makeEmitter(program: Command): Emitter {
  return (env: OutputEnvelope, opts?: EmitOptions) => {
    const g = program.opts() as GlobalOptions;
    const shaped = env.ok && g.jq ? { ok: true as const, data: applyJq(env, g.jq) } : env;
    const text = renderEnvelope(shaped as OutputEnvelope, { format: g.format });
    const target = opts?.toStderr ? process.stderr : process.stdout;
    target.write(text + "\n");
  };
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("gpt-image-cli")
    .version(VERSION)
    .description("OpenAI gpt-image-2 generation and editing CLI")
    .option("--endpoint <url>", "override OpenAI base URL")
    .option("--api-key <key>", "override OpenAI API key")
    .option("--format <format>", "output format: json | table", "json")
    .option("--jq <expr>", "jq-like path filter on envelope")
    .option("--dry-run", "print request without calling API", false)
    .option("--yes", "skip confirmation for overwriting config values", false)
    .option("--verbose", "debug info on stderr", false);

  const emit = makeEmitter(program);

  registerGenerate(program, emit);
  registerEdit(program, emit);
  registerConfig(program, emit);

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const cli = err instanceof CliError ? err : translateOpenAIError(err);
    const env = cli.toEnvelope();
    const g = program.opts() as GlobalOptions;
    const text = renderEnvelope(env, { format: g.format ?? "json" });
    process.stderr.write(text + "\n");
    if (g.verbose && err instanceof Error && err.stack) {
      process.stderr.write(err.stack + "\n");
    }
    process.exit(exitCodeFor(cli.code));
  }
}

main();
