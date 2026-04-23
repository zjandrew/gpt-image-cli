// src/framework/types.ts

export interface Config {
  apiKey: string;
  endpoint: string;
}

export type ConfigSource = "flag" | "env" | "file" | "default" | "missing";

export interface ConfigResolution {
  config: Partial<Config>;
  sources: { apiKey: ConfigSource; endpoint: ConfigSource };
}

export type ErrorCode =
  | "CONFIG_MISSING"
  | "INVALID_INPUT"
  | "IO_ERROR"
  | "OPENAI_API_ERROR"
  | "NETWORK_ERROR"
  | "INTERNAL";

export interface SuccessEnvelope<T = unknown> {
  ok: true;
  data: T;
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type OutputEnvelope = SuccessEnvelope | ErrorEnvelope;

export interface GlobalOptions {
  endpoint?: string;
  apiKey?: string;
  format: "json" | "table";
  jq?: string;
  dryRun: boolean;
  yes: boolean;
  verbose: boolean;
}

export interface ImageOpResultData {
  model: "gpt-image-2";
  operation: "generate" | "edit";
  paths: string[];
  size: string;
  quality: string;
  output_format: string;
  count: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

export interface EmitOptions {
  /** Route the envelope to stderr instead of stdout. Used by --stdout-base64. */
  toStderr?: boolean;
}

export type Emitter = (env: OutputEnvelope, opts?: EmitOptions) => void;
