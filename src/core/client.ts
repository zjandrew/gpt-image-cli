import OpenAI, { AzureOpenAI } from "openai";
import { CliError } from "../framework/errors.js";
import { resolveActiveProfile, type FlagConfigInput } from "./config.js";
import type { ResolvedProfile } from "../framework/types.js";

export interface ClientBundle {
  client: OpenAI | AzureOpenAI;
  model: string;
  profile: ResolvedProfile;
}

export function makeClient(flags: FlagConfigInput): ClientBundle {
  const { profile } = resolveActiveProfile(flags);

  if (!profile.apiKey) {
    throw new CliError(
      "CONFIG_MISSING",
      "API key not set. Set OPENAI_API_KEY or run `gpt-image-cli config init`.",
    );
  }

  if (profile.type === "openai") {
    return {
      client: new OpenAI({ apiKey: profile.apiKey, baseURL: profile.endpoint }),
      model: "gpt-image-2",
      profile,
    };
  }

  // azure
  const common = {
    endpoint: profile.endpoint,
    apiVersion: profile.apiVersion!,
    deployment: profile.deployment!,
  };
  const client =
    profile.authStyle === "bearer"
      ? new AzureOpenAI({
          ...common,
          azureADTokenProvider: async () => profile.apiKey,
        })
      : new AzureOpenAI({ ...common, apiKey: profile.apiKey });

  return { client, model: profile.deployment!, profile };
}
