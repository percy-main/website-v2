import { describe, expect, it } from "vitest";
import { isAbortError } from "./abort-errors.ts";

describe("isAbortError", () => {
  it("matches a DOMException AbortError", () => {
    expect(
      isAbortError(
        new DOMException("This operation was aborted", "AbortError"),
      ),
    ).toBe(true);
  });

  it("matches a plain Error named AbortError", () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    expect(isAbortError(error)).toBe(true);
  });

  it("matches the reason from an aborted AbortController", () => {
    const controller = new AbortController();
    controller.abort();
    expect(isAbortError(controller.signal.reason)).toBe(true);
  });

  it("rejects other errors", () => {
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError(new DOMException("timed out", "TimeoutError"))).toBe(
      false,
    );
  });

  it("rejects non-object reasons", () => {
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError(42)).toBe(false);
  });
});
