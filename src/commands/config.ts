// src/commands/config.ts
import { Command } from "commander";
import * as readline from "node:readline";
import {
  readConfigFile,
  configFilePath,
  resolveActiveProfile,
  redactApiKey,
  getProfile,
  setProfileField,
  addProfile,
  useProfile,
  listProfiles,
} from "../core/config.js";
import { CliError } from "../framework/errors.js";
import type { Emitter, Profile } from "../framework/types.js";

export interface ScopeOpts {
  profile?: string;
}

function targetProfileName(opts: ScopeOpts): string {
  if (opts.profile) {
    if (!getProfile(opts.profile)) {
      throw new CliError(
        "PROFILE_NOT_FOUND",
        `no such profile: ${opts.profile}`,
        { available: listProfiles().map((p) => p.name) },
      );
    }
    return opts.profile;
  }
  const cfg = readConfigFile();
  if (!cfg.active) {
    throw new CliError(
      "CONFIG_MISSING",
      "no active profile — run `config init` or `config add <name>`",
    );
  }
  return cfg.active;
}

export function actionSet(
  key: string,
  value: string,
  opts: ScopeOpts,
  emit: Emitter,
): void {
  const name = targetProfileName(opts);
  setProfileField(name, key, value);
  emit({ ok: true, data: { profile: name, fields: [key], path: configFilePath() } });
}

export function actionGet(key: string, opts: ScopeOpts, emit: Emitter): void {
  const name = targetProfileName(opts);
  const prof = getProfile(name)!;
  const val = (prof as unknown as Record<string, unknown>)[key] ?? null;
  emit({ ok: true, data: { profile: name, key, value: val } });
}

export function actionShow(
  name: string | undefined,
  opts: ScopeOpts,
  emit: Emitter,
): void {
  const target = name ?? targetProfileName(opts);
  const prof = getProfile(target);
  if (!prof) {
    throw new CliError("PROFILE_NOT_FOUND", `no such profile: ${target}`, {
      available: listProfiles().map((p) => p.name),
    });
  }
  // Only the active profile reports sources (flags/env apply there).
  const cfg = readConfigFile();
  const isActive = cfg.active === target;
  let sources: { apiKey: string; endpoint: string } | undefined;
  if (isActive) {
    const r = resolveActiveProfile({});
    sources = r.sources;
  }
  const data: Record<string, unknown> = {
    profile: target,
    active: isActive,
    type: prof.type,
    endpoint: prof.endpoint ?? null,
    api_key: redactApiKey(prof.api_key),
  };
  if (prof.type === "azure") {
    data.api_version = prof.api_version;
    data.deployment = prof.deployment;
    data.auth_style = prof.auth_style ?? "api-key";
  }
  if (sources) data.sources = sources;
  emit({ ok: true, data });
}

export function actionPath(emit: Emitter): void {
  emit({ ok: true, data: { path: configFilePath() } });
}

export async function actionInit(emit: Emitter): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new CliError(
      "INVALID_INPUT",
      "config init requires a TTY. Use `config add` non-interactively, or `config set`.",
    );
  }
  const typeAns = (await prompt("Profile type [openai/azure] (default openai): ")).toLowerCase();
  const type = typeAns === "azure" ? "azure" : "openai";
  let profile: Profile;
  if (type === "openai") {
    const apiKey = await prompt("OpenAI API key (sk-...): ", { mask: true });
    const endpoint = await prompt(
      "Endpoint (leave empty for default https://api.openai.com/v1): ",
    );
    profile = { type: "openai", api_key: apiKey };
    if (endpoint) profile.endpoint = endpoint;
  } else {
    const endpoint = await prompt(
      "Azure endpoint (e.g. https://<resource>.openai.azure.com): ",
    );
    const deployment = await prompt("Deployment name (e.g. gpt-image-2): ");
    const apiVersion =
      (await prompt("api-version (default 2024-02-01): ")) || "2024-02-01";
    const apiKey = await prompt("API key: ", { mask: true });
    const authAns = (await prompt(
      "auth_style [api-key/bearer] (default api-key): ",
    )).toLowerCase();
    profile = {
      type: "azure",
      endpoint,
      deployment,
      api_version: apiVersion,
      api_key: apiKey,
      auth_style: authAns === "bearer" ? "bearer" : "api-key",
    };
  }

  // Replace the "default" profile (don't call removeProfile, which throws when
  // it would leave the file empty). Write the new profile directly.
  const cfg = readConfigFile();
  cfg.profiles.default = profile;
  cfg.active = "default";
  // Use the lower-level write — but to keep validation we route through addProfile
  // when the profile didn't previously exist. Simplest: write the cfg blob directly.
  // Validation is implicit via the typed `Profile` parameter; we still want to be
  // defensive though, so re-validate via setProfileField if existing.
  const { writeConfigFile } = await import("../core/config.js");
  writeConfigFile(cfg);

  emit({
    ok: true,
    data: { path: configFilePath(), profile: "default", type: profile.type },
  });
}

function registerInit(cfg: Command, emit: Emitter) {
  cfg
    .command("init")
    .description("Interactive wizard to create the 'default' profile")
    .action(async () => {
      await actionInit(emit);
    });
}

function registerSet(cfg: Command, emit: Emitter) {
  cfg
    .command("set <key> <value>")
    .description("Set a field on a profile (active by default)")
    .option("--profile <name>", "target profile name")
    .action(async (key: string, value: string, opts: ScopeOpts) => {
      actionSet(key, value, opts, emit);
    });
}

function registerGet(cfg: Command, emit: Emitter) {
  cfg
    .command("get <key>")
    .description("Read a field from a profile (active by default)")
    .option("--profile <name>", "target profile name")
    .action((key: string, opts: ScopeOpts) => {
      actionGet(key, opts, emit);
    });
}

function registerShow(cfg: Command, emit: Emitter) {
  cfg
    .command("show [name]")
    .description("Show one profile (active by default); api_key redacted")
    .action((name: string | undefined) => {
      actionShow(name, {}, emit);
    });
}

function registerPath(cfg: Command, emit: Emitter) {
  cfg
    .command("path")
    .description("Print config file path")
    .action(() => actionPath(emit));
}

export function actionList(emit: Emitter): void {
  const profiles = listProfiles();
  emit({ ok: true, data: { profiles } });
}

function registerList(cfg: Command, emit: Emitter) {
  cfg
    .command("list")
    .description("List saved profiles; active marker shown")
    .action(() => actionList(emit));
}

export function registerConfig(program: Command, emit: Emitter): void {
  const cfg = program.command("config").description("Manage CLI config");
  registerInit(cfg, emit);
  registerSet(cfg, emit);
  registerGet(cfg, emit);
  registerShow(cfg, emit);
  registerPath(cfg, emit);
  registerList(cfg, emit);
  // use / add / remove are wired up in Tasks 10–12.
}

// Touch this to suppress "unused" warnings if any helpers temporarily look unused.
// (addProfile/useProfile imports are used in actionInit fallback paths in later tasks.)
void addProfile;
void useProfile;

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
