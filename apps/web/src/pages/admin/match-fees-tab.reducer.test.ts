import { describe, expect, it } from "vitest";
import {
  buildAddRatePayload,
  initialNewRateFormState,
  isFormReady,
  newRateFormReducer,
  parseAmountPence,
} from "./match-fees-tab.reducer";

describe("newRateFormReducer", () => {
  it("starts empty with all-teams scope", () => {
    expect(initialNewRateFormState).toEqual({
      category: "",
      amount: "",
      teamId: "all",
      competitionType: "",
    });
  });

  it("setCategory updates only category", () => {
    const next = newRateFormReducer(initialNewRateFormState, {
      type: "setCategory",
      value: "senior",
    });
    expect(next.category).toBe("senior");
    expect(next.amount).toBe("");
    expect(next.teamId).toBe("all");
  });

  it("setAmount updates only amount", () => {
    const next = newRateFormReducer(initialNewRateFormState, {
      type: "setAmount",
      value: "5.50",
    });
    expect(next.amount).toBe("5.50");
    expect(next.category).toBe("");
  });

  it("reset returns to the initial state", () => {
    const dirty = {
      category: "junior",
      amount: "3",
      teamId: "team-123",
      competitionType: "League",
    };
    expect(newRateFormReducer(dirty, { type: "reset" })).toEqual(
      initialNewRateFormState,
    );
  });
});

describe("parseAmountPence", () => {
  it("converts whole pounds", () => {
    expect(parseAmountPence("5")).toBe(500);
  });

  it("converts decimals to pence", () => {
    expect(parseAmountPence("5.50")).toBe(550);
    expect(parseAmountPence("0.99")).toBe(99);
  });

  it("trims whitespace", () => {
    expect(parseAmountPence("  10  ")).toBe(1000);
  });

  it("rounds half-pence up", () => {
    expect(parseAmountPence("5.555")).toBe(556);
  });

  it("returns null for empty input", () => {
    expect(parseAmountPence("")).toBeNull();
    expect(parseAmountPence("   ")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(parseAmountPence("free")).toBeNull();
  });

  it("returns null for negative amounts", () => {
    expect(parseAmountPence("-5")).toBeNull();
  });
});

describe("isFormReady", () => {
  it("requires category and a valid amount", () => {
    expect(isFormReady(initialNewRateFormState)).toBe(false);
    expect(
      isFormReady({ ...initialNewRateFormState, category: "senior" }),
    ).toBe(false);
    expect(
      isFormReady({
        ...initialNewRateFormState,
        category: "senior",
        amount: "5",
      }),
    ).toBe(true);
  });

  it("rejects negative amounts", () => {
    expect(
      isFormReady({
        ...initialNewRateFormState,
        category: "senior",
        amount: "-1",
      }),
    ).toBe(false);
  });
});

describe("buildAddRatePayload", () => {
  it("returns null when not ready", () => {
    expect(buildAddRatePayload(initialNewRateFormState)).toBeNull();
  });

  it("omits team scope when 'all'", () => {
    expect(
      buildAddRatePayload({
        category: "senior",
        amount: "5.50",
        teamId: "all",
        competitionType: "",
      }),
    ).toEqual({
      memberCategory: "senior",
      amountPence: 550,
      playCricketTeamId: undefined,
      competitionType: undefined,
    });
  });

  it("includes team and competition when set", () => {
    expect(
      buildAddRatePayload({
        category: "junior",
        amount: "3",
        teamId: "team-1",
        competitionType: "League",
      }),
    ).toEqual({
      memberCategory: "junior",
      amountPence: 300,
      playCricketTeamId: "team-1",
      competitionType: "League",
    });
  });
});
