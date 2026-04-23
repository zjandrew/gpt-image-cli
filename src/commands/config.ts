// src/commands/config.ts
import { Command } from "commander";
import * as readline from "node:readline";
import {
  readConfigFile,
  writeConfigFile,
  configFilePath,
  resolveConfig,
  redactApiKey,
  type ConfigFile,
} from "../core/config.js";
import { CliError } from "../framework/errors.js";
import type { Emitter } from "../framework/types.js";

const ALLOWED_KEYS = new Set(["api_key", "endpoint"]);

export function registerConfig(program: Command, emit: Emitter): void {
  const cfg = program.command("config").description("Manage CLI config");

  cfg
    .command("init")
    .description("Interactive wizard to create config file")
    .action(async () => {
      if (!process.stdin.isTTY) {
        throw new CliError(
          "INVALID_INPUT",
          "config init requires a TTY. Use `config set <key> <value>` instead.",
        );
      }
      const apiKey = await prompt("OpenAI API key (sk-...): ", { mask: true });
      const endpoint = await prompt(
        "Endpoint (leave empty for default https://api.openai.com/v1): ",
      );
      const existing = readConfigFile();
      const next: ConfigFile = { ...existing };
      if (apiKey) next.api_key = apiKey;
      if (endpoint) next.endpoint = endpoint;
      writeConfigFile(next);
      emit({
        ok: true,
        data: {
          path: configFilePath(),
          fields: Object.keys(next).filter((k) => (next as Record<string, unknown>)[k]),
        },
      });
    });

  cfg
    .command("set <key> <value>")
    .description("Set a config key. Keys: api_key, endpoint")
    .action(async (key: string, value: string, _opts, cmd) => {
      if (!ALLOWED_KEYS.has(key)) {
        throw new CliError("INVALID_INPUT", `Unknown key: ${key}. Allowed: api_key, endpoint`);
      }
      const existing = readConfigFile();
      const globalOpts = cmd.optsWithGlobals() as { yes?: boolean };
      if (
        (existing as Record<string, unknown>)[key] &&
        !globalOpts.yes &&
        process.stdin.isTTY
      ) {
        const ans = await prompt(`Overwrite existing ${key}? [y/N]: `);
        if (!/^y/i.test(ans)) {
          throw new CliError("INVALID_INPUT", "aborted");
        }
      }
      const next = { ...existing, [key]: value };
      writeConfigFile(next);
      emit({ ok: true, data: { path: configFilePath(), fields: [key] } });
    });

  cfg
    .command("get <key>")
    .description("Print a config key")
    .action((key: string) => {
      if (!ALLOWED_KEYS.has(key)) {
        throw new CliError("INVALID_INPUT", `Unknown key: ${key}`);
      }
      const file = readConfigFile();
      const val = (file as Record<string, unknown>)[key] ?? null;
      emit({ ok: true, data: { key, value: val } });
    });

  cfg
    .command("show")
    .description("Show effective config (api_key redacted)")
    .action((_opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as { apiKey?: string; endpoint?: string };
      const r = resolveConfig({ apiKey: globalOpts.apiKey, endpoint: globalOpts.endpoint });
      emit({
        ok: true,
        data: {
          api_key: redactApiKey(r.config.apiKey),
          endpoint: r.config.endpoint ?? null,
          sources: r.sources,
        },
      });
    });

  cfg
    .command("path")
    .description("Print config file path")
    .action(() => {
      emit({ ok: true, data: { path: configFilePath() } });
    });
}

function prompt(question: string, opts: { mask?: boolean } = {}): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (opts.mask) {
      // Simple masking: we don't echo; readline will still capture input
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    }
    rl.question(question, (ans) => {
      rl.close();
      if (opts.mask) process.stdout.write("\n");
      resolve(ans.trim());
    });
  });
}
