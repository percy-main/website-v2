import { describe, expect, it } from "vitest";
import {
  buildAddExpensePayload,
  buildConfirmPayload,
  confirmationFormReducer,
  expenseFormReducer,
  initialConfirmationFormState,
  initialExpenseFormState,
  parsePencePounds,
  type ExpenseFormState,
} from "./official.reducer";

describe("confirmationFormReducer", () => {
  it("starts not confirming with no statuses", () => {
    expect(initialConfirmationFormState).toEqual({
      confirming: false,
      playerStatuses: {},
    });
  });

  it("start defaults all players to playing and flips confirming on", () => {
    const next = confirmationFormReducer(initialConfirmationFormState, {
      type: "start",
      playerIds: ["a", "b", "c"],
    });
    expect(next.confirming).toBe(true);
    expect(next.playerStatuses).toEqual({
      a: "playing",
      b: "playing",
      c: "playing",
    });
  });

  it("setStatus updates a single player without losing others", () => {
    const seeded = confirmationFormReducer(initialConfirmationFormState, {
      type: "start",
      playerIds: ["a", "b"],
    });
    const next = confirmationFormReducer(seeded, {
      type: "setStatus",
      playerId: "a",
      status: "no_show",
    });
    expect(next.playerStatuses).toEqual({
      a: "no_show",
      b: "playing",
    });
  });

  it("cancel keeps statuses but flips confirming off", () => {
    const seeded = confirmationFormReducer(initialConfirmationFormState, {
      type: "start",
      playerIds: ["a"],
    });
    const next = confirmationFormReducer(seeded, { type: "cancel" });
    expect(next.confirming).toBe(false);
    expect(next.playerStatuses).toEqual({ a: "playing" });
  });

  it("reset returns to the initial state", () => {
    const seeded = confirmationFormReducer(initialConfirmationFormState, {
      type: "start",
      playerIds: ["a", "b"],
    });
    expect(confirmationFormReducer(seeded, { type: "reset" })).toEqual(
      initialConfirmationFormState,
    );
  });
});

describe("buildConfirmPayload", () => {
  it("flattens the status map into the API array shape", () => {
    const state = confirmationFormReducer(initialConfirmationFormState, {
      type: "start",
      playerIds: ["a", "b"],
    });
    const next = confirmationFormReducer(state, {
      type: "setStatus",
      playerId: "b",
      status: "dropped_out",
    });
    expect(buildConfirmPayload(next).playerStatuses).toEqual(
      expect.arrayContaining([
        { matchdayPlayerId: "a", status: "playing" },
        { matchdayPlayerId: "b", status: "dropped_out" },
      ]),
    );
  });

  it("emits an empty array when no players are loaded", () => {
    expect(buildConfirmPayload(initialConfirmationFormState)).toEqual({
      playerStatuses: [],
    });
  });
});

describe("expenseFormReducer", () => {
  it("starts as umpire_fee with all fields blank", () => {
    expect(initialExpenseFormState).toEqual({
      expenseType: "umpire_fee",
      description: "",
      amount: "",
      matchBallUsed: true,
      matchBallCost: "",
      receiptPreview: null,
      receiptDataUrl: null,
      compressing: false,
    });
  });

  it("setExpenseType wipes per-type fields", () => {
    const dirty: ExpenseFormState = {
      ...initialExpenseFormState,
      description: "J. Smith",
      amount: "20",
    };
    const next = expenseFormReducer(dirty, {
      type: "setExpenseType",
      value: "match_ball",
    });
    expect(next.expenseType).toBe("match_ball");
    expect(next.description).toBe("");
    expect(next.amount).toBe("");
    expect(next.matchBallUsed).toBe(true);
  });

  it("setDescription / setAmount only touch their fields", () => {
    const a = expenseFormReducer(initialExpenseFormState, {
      type: "setDescription",
      value: "J. Smith",
    });
    expect(a.description).toBe("J. Smith");
    const b = expenseFormReducer(a, { type: "setAmount", value: "20" });
    expect(b.amount).toBe("20");
    expect(b.description).toBe("J. Smith");
  });

  it("setMatchBallUsed and setMatchBallCost compose", () => {
    const a = expenseFormReducer(initialExpenseFormState, {
      type: "setMatchBallUsed",
      value: false,
    });
    expect(a.matchBallUsed).toBe(false);
    const b = expenseFormReducer(a, {
      type: "setMatchBallCost",
      value: "12.50",
    });
    expect(b.matchBallCost).toBe("12.50");
    expect(b.matchBallUsed).toBe(false);
  });

  it("setReceipt updates both preview and dataUrl together", () => {
    const next = expenseFormReducer(initialExpenseFormState, {
      type: "setReceipt",
      preview: "data:image/png;base64,AAAA",
      dataUrl: "data:image/png;base64,AAAA",
    });
    expect(next.receiptPreview).toBe("data:image/png;base64,AAAA");
    expect(next.receiptDataUrl).toBe("data:image/png;base64,AAAA");
  });

  it("resetFields preserves the selected expense type", () => {
    const seeded: ExpenseFormState = {
      ...initialExpenseFormState,
      expenseType: "scorer_fee",
      description: "A. Jones",
      amount: "15",
    };
    const next = expenseFormReducer(seeded, { type: "resetFields" });
    expect(next.expenseType).toBe("scorer_fee");
    expect(next.description).toBe("");
    expect(next.amount).toBe("");
  });

  it("reset returns fully to the initial state", () => {
    const seeded: ExpenseFormState = {
      ...initialExpenseFormState,
      expenseType: "scorer_fee",
      description: "A. Jones",
    };
    expect(expenseFormReducer(seeded, { type: "reset" })).toEqual(
      initialExpenseFormState,
    );
  });
});

describe("parsePencePounds", () => {
  it("converts whole pounds", () => {
    expect(parsePencePounds("5")).toBe(500);
  });

  it("converts decimals", () => {
    expect(parsePencePounds("5.50")).toBe(550);
    expect(parsePencePounds("0.99")).toBe(99);
  });

  it("trims whitespace", () => {
    expect(parsePencePounds("  10  ")).toBe(1000);
  });

  it("rounds half-pence up", () => {
    expect(parsePencePounds("5.555")).toBe(556);
  });

  it("returns null for empty / non-numeric / negative", () => {
    expect(parsePencePounds("")).toBeNull();
    expect(parsePencePounds("   ")).toBeNull();
    expect(parsePencePounds("free")).toBeNull();
    expect(parsePencePounds("-1")).toBeNull();
  });
});

describe("buildAddExpensePayload", () => {
  it("returns null when the form is empty", () => {
    expect(buildAddExpensePayload(initialExpenseFormState)).toBeNull();
  });

  it("builds an umpire_fee payload from description + amount", () => {
    const state: ExpenseFormState = {
      ...initialExpenseFormState,
      expenseType: "umpire_fee",
      description: "  J. Smith  ",
      amount: "20",
    };
    expect(buildAddExpensePayload(state)).toEqual({
      type: "umpire_fee",
      description: "J. Smith",
      amountPence: 2000,
      receiptImage: undefined,
    });
  });

  it("omits an empty/whitespace-only description", () => {
    const state: ExpenseFormState = {
      ...initialExpenseFormState,
      expenseType: "miscellaneous",
      description: "   ",
      amount: "1",
    };
    expect(buildAddExpensePayload(state)).toMatchObject({
      type: "miscellaneous",
      amountPence: 100,
      description: undefined,
    });
  });

  it("includes the receipt data URL when present", () => {
    const state: ExpenseFormState = {
      ...initialExpenseFormState,
      expenseType: "teas",
      amount: "30",
      receiptDataUrl: "data:image/png;base64,xyz",
    };
    expect(buildAddExpensePayload(state)?.receiptImage).toBe(
      "data:image/png;base64,xyz",
    );
  });

  it("returns null for match_ball when not used", () => {
    const state: ExpenseFormState = {
      ...initialExpenseFormState,
      expenseType: "match_ball",
      matchBallUsed: false,
      matchBallCost: "10",
    };
    expect(buildAddExpensePayload(state)).toBeNull();
  });

  it("returns null for match_ball when cost is zero", () => {
    const state: ExpenseFormState = {
      ...initialExpenseFormState,
      expenseType: "match_ball",
      matchBallUsed: true,
      matchBallCost: "0",
    };
    expect(buildAddExpensePayload(state)).toBeNull();
  });

  it("builds a match_ball payload with a fixed description", () => {
    const state: ExpenseFormState = {
      ...initialExpenseFormState,
      expenseType: "match_ball",
      matchBallUsed: true,
      matchBallCost: "12.50",
    };
    expect(buildAddExpensePayload(state)).toEqual({
      type: "match_ball",
      description: "New match ball",
      amountPence: 1250,
      receiptImage: undefined,
    });
  });
});
