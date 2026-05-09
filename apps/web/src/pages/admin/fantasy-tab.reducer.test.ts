import { describe, expect, it } from "vitest";
import {
  chaosWeekFormReducer,
  initialChaosWeekFormState,
  showsRuleConfig,
} from "./fantasy-tab.reducer";

describe("chaosWeekFormReducer", () => {
  it("starts empty with sendEmail off", () => {
    expect(initialChaosWeekFormState).toEqual({
      gameweekId: "",
      ruleType: "",
      name: "",
      description: "",
      ruleConfig: "",
      sendEmail: false,
    });
  });

  it("setGameweekId updates only gameweekId", () => {
    const next = chaosWeekFormReducer(initialChaosWeekFormState, {
      type: "setGameweekId",
      value: "5",
    });
    expect(next.gameweekId).toBe("5");
    expect(next.name).toBe("");
  });

  it("setRuleType to scoring_modifier seeds the rule-config preset", () => {
    const next = chaosWeekFormReducer(initialChaosWeekFormState, {
      type: "setRuleType",
      value: "scoring_modifier",
    });
    expect(next.ruleType).toBe("scoring_modifier");
    expect(JSON.parse(next.ruleConfig)).toEqual({
      sandwich_cost_min: 1,
      sandwich_cost_max: 1,
      multiplier: 2,
    });
  });

  it("setRuleType to scoring_threshold seeds the threshold preset", () => {
    const next = chaosWeekFormReducer(initialChaosWeekFormState, {
      type: "setRuleType",
      value: "scoring_threshold",
    });
    expect(JSON.parse(next.ruleConfig)).toEqual({
      min_runs: 30,
      min_wickets: 3,
    });
  });

  it("setRuleType to a rule without preset clears existing ruleConfig", () => {
    const dirty = {
      ...initialChaosWeekFormState,
      ruleType: "scoring_modifier",
      ruleConfig: '{"foo":1}',
    };
    const next = chaosWeekFormReducer(dirty, {
      type: "setRuleType",
      value: "no_transfers",
    });
    expect(next.ruleType).toBe("no_transfers");
    expect(next.ruleConfig).toBe("");
  });

  it("setRuleType to empty clears ruleConfig", () => {
    const dirty = {
      ...initialChaosWeekFormState,
      ruleType: "scoring_modifier",
      ruleConfig: '{"foo":1}',
    };
    const next = chaosWeekFormReducer(dirty, {
      type: "setRuleType",
      value: "",
    });
    expect(next.ruleConfig).toBe("");
  });

  it("setName / setDescription / setRuleConfig only mutate that field", () => {
    let s = chaosWeekFormReducer(initialChaosWeekFormState, {
      type: "setName",
      value: "Sandwich Week",
    });
    s = chaosWeekFormReducer(s, {
      type: "setDescription",
      value: "Cheap players double",
    });
    s = chaosWeekFormReducer(s, {
      type: "setRuleConfig",
      value: '{"x":1}',
    });
    expect(s.name).toBe("Sandwich Week");
    expect(s.description).toBe("Cheap players double");
    expect(s.ruleConfig).toBe('{"x":1}');
  });

  it("setSendEmail toggles the flag", () => {
    const next = chaosWeekFormReducer(initialChaosWeekFormState, {
      type: "setSendEmail",
      value: true,
    });
    expect(next.sendEmail).toBe(true);
  });

  it("reset returns to the initial state", () => {
    const dirty: typeof initialChaosWeekFormState = {
      gameweekId: "5",
      ruleType: "scoring_modifier",
      name: "X",
      description: "Y",
      ruleConfig: '{"x":1}',
      sendEmail: true,
    };
    expect(chaosWeekFormReducer(dirty, { type: "reset" })).toEqual(
      initialChaosWeekFormState,
    );
  });
});

describe("showsRuleConfig", () => {
  it("is true for scoring_modifier and scoring_threshold", () => {
    expect(showsRuleConfig("scoring_modifier")).toBe(true);
    expect(showsRuleConfig("scoring_threshold")).toBe(true);
  });

  it("is false for other rule types and empty string", () => {
    expect(showsRuleConfig("")).toBe(false);
    expect(showsRuleConfig("no_transfers")).toBe(false);
    expect(showsRuleConfig("reverse_scoring")).toBe(false);
  });
});
