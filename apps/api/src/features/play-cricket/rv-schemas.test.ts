import { describe, expect, it } from "vitest";
import { canonicaliseExtrasType, isUnmappedExtra } from "./rv-schemas.ts";

describe("canonicaliseExtrasType", () => {
  it("maps RV's numeric codes 1..4 to canonical strings", () => {
    expect(canonicaliseExtrasType(1)).toBe("nb");
    expect(canonicaliseExtrasType(2)).toBe("wd");
    expect(canonicaliseExtrasType(3)).toBe("b");
    expect(canonicaliseExtrasType(4)).toBe("lb");
  });

  it("passes canonical strings through unchanged (idempotent)", () => {
    expect(canonicaliseExtrasType("wd")).toBe("wd");
    expect(canonicaliseExtrasType("nb")).toBe("nb");
    expect(canonicaliseExtrasType("b")).toBe("b");
    expect(canonicaliseExtrasType("lb")).toBe("lb");
  });

  it("normalises s_desc-style and longer-form variants to canonical", () => {
    expect(canonicaliseExtrasType("w")).toBe("wd");
    expect(canonicaliseExtrasType("Wide")).toBe("wd");
    expect(canonicaliseExtrasType(" NB ")).toBe("nb");
    expect(canonicaliseExtrasType("no-ball")).toBe("nb");
    expect(canonicaliseExtrasType("noball")).toBe("nb");
    expect(canonicaliseExtrasType("bye")).toBe("b");
    expect(canonicaliseExtrasType("leg-bye")).toBe("lb");
    expect(canonicaliseExtrasType("legbye")).toBe("lb");
  });

  it("returns null for absent / empty inputs", () => {
    expect(canonicaliseExtrasType(null)).toBeNull();
    expect(canonicaliseExtrasType(undefined)).toBeNull();
    expect(canonicaliseExtrasType("")).toBeNull();
    expect(canonicaliseExtrasType("   ")).toBeNull();
  });

  it("returns null for unknown numeric codes (does not fabricate a meaning)", () => {
    expect(canonicaliseExtrasType(0)).toBeNull();
    expect(canonicaliseExtrasType(5)).toBeNull();
    expect(canonicaliseExtrasType(99)).toBeNull();
    expect(canonicaliseExtrasType(-1)).toBeNull();
  });

  it("returns null for unknown string codes", () => {
    expect(canonicaliseExtrasType("xyz")).toBeNull();
    expect(canonicaliseExtrasType("penalty")).toBeNull();
  });
});

describe("isUnmappedExtra", () => {
  it("flags non-null inputs that didn't canonicalise", () => {
    expect(isUnmappedExtra(5, null)).toBe(true);
    expect(isUnmappedExtra("xyz", null)).toBe(true);
    expect(isUnmappedExtra(99, null)).toBe(true);
  });

  it("does not flag null/empty inputs (no extra → not 'unmapped')", () => {
    expect(isUnmappedExtra(null, null)).toBe(false);
    expect(isUnmappedExtra(undefined, null)).toBe(false);
    expect(isUnmappedExtra("", null)).toBe(false);
    expect(isUnmappedExtra("   ", null)).toBe(false);
  });

  it("does not flag inputs that successfully canonicalised", () => {
    expect(isUnmappedExtra(1, "nb")).toBe(false);
    expect(isUnmappedExtra("wd", "wd")).toBe(false);
    expect(isUnmappedExtra("Wide", "wd")).toBe(false);
  });
});
