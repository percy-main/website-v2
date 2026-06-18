import { describe, expect, it } from "vitest";
import { decideExpenseSchema, submitExpenseSchema } from "./schemas.ts";

describe("submitExpenseSchema receipt rule (EXPENSES.md 13.9)", () => {
  it("rejects a claim over GBP 10 with no receipt", () => {
    const result = submitExpenseSchema.safeParse({
      description: "Big spend",
      amountPence: 1500,
      tagNames: ["fuel"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a claim over GBP 10 with a receipt", () => {
    const result = submitExpenseSchema.safeParse({
      description: "Big spend",
      amountPence: 1500,
      receiptImage: "data:image/png;base64,iVBORw0KGgo=",
      tagNames: ["fuel"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a claim of GBP 10 or under with no receipt", () => {
    const result = submitExpenseSchema.safeParse({
      description: "Small spend",
      amountPence: 1000,
      tagNames: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-positive amount", () => {
    const result = submitExpenseSchema.safeParse({
      description: "x",
      amountPence: 0,
      tagNames: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("decideExpenseSchema", () => {
  it("accepts approve with a final tag set", () => {
    const result = decideExpenseSchema.safeParse({
      decision: "approve",
      tagNames: ["umpires fee"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown decision", () => {
    const result = decideExpenseSchema.safeParse({ decision: "maybe" });
    expect(result.success).toBe(false);
  });
});
