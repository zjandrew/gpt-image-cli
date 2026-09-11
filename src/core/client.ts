import OpenAI, { AzureOpenAI } from "openai";
import { CliError } from "../framework/errors.js";
import { resolveActiveProfile, type FlagConfigInput } from "./config.js";
import type { ResolvedProfile } from "../framework/types.js";

// Default model for OpenAI-type profiles. Azure profiles use their deployment name.
export const DEFAULT_MODEL = "gpt-image-2.5-flare";

export interface ClientBundle {
  client: OpenAI | AzureOpenAI;
  model: string;
  profile: ResolvedProfile;
}

/**
 * Effective model for a request. `--model` overrides everything: for openai
 * profiles it is the model id, for azure profiles it is the deployment name
 * (deployments are conventionally named after the model id).
 */
export function resolveModel(profile: ResolvedProfile, override?: string): string {
  const o = override?.trim();
  if (o) return o;
  return profile.type === "azure" ? profile.deployment! : DEFAULT_MODEL;
}

export function makeClient(flags: FlagConfigInput, modelOverride?: string): ClientBundle {
  const { profile } = resolveActiveProfile(flags);

  if (!profile.apiKey) {
    throw new CliError(
      "CONFIG_MISSING",
      "API key not set. Set OPENAI_API_KEY or run `gpt-image-cli config init`.",
    );
  }

  const model = resolveModel(profile, modelOverride);

  if (profile.type === "openai") {
    return {
      client: new OpenAI({ apiKey: profile.apiKey, baseURL: profile.endpoint }),
      model,
      profile,
    };
  }

  // azure — `model` doubles as the deployment name
  const common = {
    endpoint: profile.endpoint,
    apiVersion: profile.apiVersion!,
    deployment: model,
  };
  const client =
    profile.authStyle === "bearer"
      ? new AzureOpenAI({
          ...common,
          azureADTokenProvider: async () => profile.apiKey,
        })
      : new AzureOpenAI({ ...common, apiKey: profile.apiKey });

  return { client, model, profile };
}
