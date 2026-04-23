import type { ErrorCode, ErrorEnvelope } from "./types.js";

export class CliError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CliError";
  }

  toEnvelope(): ErrorEnvelope {
    return {
      ok: false,
      error: { code: this.code, message: this.message, details: this.details },
    };
  }
}

const EXIT_CODES: Record<ErrorCode, number> = {
  CONFIG_MISSING: 2,
  INVALID_INPUT: 2,
  IO_ERROR: 3,
  OPENAI_API_ERROR: 4,
  NETWORK_ERROR: 5,
  INTERNAL: 10,
};

export function exitCodeFor(code: ErrorCode): number {
  return EXIT_CODES[code];
}

const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

export function translateOpenAIError(err: unknown): CliError {
  if (err instanceof CliError) return err;
  const anyErr = err as { status?: number; code?: string; type?: string; message?: string };
  if (anyErr.code && NETWORK_CODES.has(anyErr.code)) {
    return new CliError("NETWORK_ERROR", anyErr.message ?? "network error", {
      code: anyErr.code,
    });
  }
  if (typeof anyErr.status === "number") {
    return new CliError("OPENAI_API_ERROR", anyErr.message ?? "OpenAI API error", {
      status: anyErr.status,
      code: anyErr.code,
      type: anyErr.type,
    });
  }
  return new CliError("INTERNAL", anyErr.message ?? "unknown error");
}
