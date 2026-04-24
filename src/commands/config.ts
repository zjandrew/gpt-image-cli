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
  if (opts.mask) return promptMasked(question);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

function promptMasked(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    if (!process.stdin.setRawMode) {
      reject(new Error("stdin does not support setRawMode; cannot mask input"));
      return;
    }
    process.stdin.resume();
    process.stdin.setRawMode(true);
    let buf = "";
    const onData = (data: Buffer) => {
      const s = data.toString("utf8");
      for (const ch of s) {
        const code = ch.charCodeAt(0);
        if (code === 0x0d || code === 0x0a) {
          process.stdin.setRawMode!(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(buf.trim());
          return;
        } else if (code === 0x7f || code === 0x08) {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (code === 0x03) {
          process.stdin.setRawMode!(false);
          process.stdout.write("\n");
          process.exit(130);
        } else if (code >= 0x20) {
          buf += ch;
          process.stdout.write("*");
        }
      }
    };
    process.stdin.on("data", onData);
  });
}
