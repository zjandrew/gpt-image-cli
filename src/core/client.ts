// src/core/client.ts
import OpenAI from "openai";
import { CliError } from "../framework/errors.js";
import { resolveConfig, type FlagConfigInput } from "./config.js";

export function makeClient(flags: FlagConfigInput): OpenAI {
  const { config } = resolveConfig(flags);
  if (!config.apiKey) {
    throw new CliError(
      "CONFIG_MISSING",
      "OpenAI API key not set. Set OPENAI_API_KEY or run `gpt-image-cli config init`.",
    );
  }
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.endpoint,
  });
}
