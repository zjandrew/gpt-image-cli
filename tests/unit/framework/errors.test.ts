import { describe, it, expect } from "vitest";
import {
  CliError,
  exitCodeFor,
  translateOpenAIError,
} from "../../../src/framework/errors.js";

describe("CliError", () => {
  it("stores code, message, details", () => {
    const err = new CliError("INVALID_INPUT", "bad", { field: "size" });
    expect(err.code).toBe("INVALID_INPUT");
    expect(err.message).toBe("bad");
    expect(err.details).toEqual({ field: "size" });
  });

  it("toEnvelope produces error envelope", () => {
    const env = new CliError("IO_ERROR", "cannot write").toEnvelope();
    expect(env).toEqual({
      ok: false,
      error: { code: "IO_ERROR", message: "cannot write", details: undefined },
    });
  });
});

describe("exitCodeFor", () => {
  it("maps codes", () => {
    expect(exitCodeFor("CONFIG_MISSING")).toBe(2);
    expect(exitCodeFor("INVALID_INPUT")).toBe(2);
    expect(exitCodeFor("IO_ERROR")).toBe(3);
    expect(exitCodeFor("OPENAI_API_ERROR")).toBe(4);
    expect(exitCodeFor("NETWORK_ERROR")).toBe(5);
    expect(exitCodeFor("INTERNAL")).toBe(10);
  });
});

describe("translateOpenAIError", () => {
  it("wraps APIError with status & code", () => {
    const apiErr: any = new Error("quota");
    apiErr.status = 429;
    apiErr.code = "quota_exceeded";
    apiErr.type = "insufficient_quota";
    const cli = translateOpenAIError(apiErr);
    expect(cli.code).toBe("OPENAI_API_ERROR");
    expect(cli.details).toMatchObject({
      status: 429,
      code: "quota_exceeded",
      type: "insufficient_quota",
    });
  });

  it("detects network errors by code", () => {
    const netErr: any = new Error("ENOTFOUND");
    netErr.code = "ENOTFOUND";
    const cli = translateOpenAIError(netErr);
    expect(cli.code).toBe("NETWORK_ERROR");
  });

  it("unwraps network code from err.cause", () => {
    const inner: any = new Error("socket hang up");
    inner.code = "ECONNRESET";
    const outer: any = new Error("Connection error.");
    outer.cause = inner;
    const cli = translateOpenAIError(outer);
    expect(cli.code).toBe("NETWORK_ERROR");
    expect(cli.details).toMatchObject({ code: "ECONNRESET" });
  });

  it("recognizes OpenAI APIConnectionError by name", () => {
    const err: any = new Error("Connection error.");
    err.name = "APIConnectionError";
    const cli = translateOpenAIError(err);
    expect(cli.code).toBe("NETWORK_ERROR");
    expect(cli.details).toMatchObject({ name: "APIConnectionError" });
  });

  it("recognizes APIConnectionTimeoutError by name", () => {
    const err: any = new Error("Request timed out.");
    err.name = "APIConnectionTimeoutError";
    const cli = translateOpenAIError(err);
    expect(cli.code).toBe("NETWORK_ERROR");
  });
});
