import { describe, expect, it } from "vitest";
import {
  buildFactEditPatch,
  buildFactsListQuery,
  factEditReducer,
  factsListReducer,
  initialFactEditFormState,
  initialFactsListState,
  makeFactEditFormState,
  parseTagsText,
  type FactSeed,
} from "./facts-admin.reducer";

const seed: FactSeed = {
  content: "Original content",
  scope: "club",
  confidence: 3,
  permanence: "seasonal",
  tags: { team: "Mitford CC" },
};

describe("factsListReducer", () => {
  it("starts with all filters empty", () => {
    expect(initialFactsListState).toEqual({ scope: "", q: "", tag: "" });
  });

  it("setScope, setQ, setTag update only that field", () => {
    let s = factsListReducer(initialFactsListState, {
      type: "setScope",
      value: "club",
    });
    expect(s).toEqual({ scope: "club", q: "", tag: "" });
    s = factsListReducer(s, { type: "setQ", value: "covers" });
    expect(s).toEqual({ scope: "club", q: "covers", tag: "" });
    s = factsListReducer(s, { type: "setTag", value: "team:Mitford" });
    expect(s).toEqual({ scope: "club", q: "covers", tag: "team:Mitford" });
  });

  it("reset returns to the initial state", () => {
    expect(
      factsListReducer({ scope: "user", q: "x", tag: "y" }, { type: "reset" }),
    ).toEqual(initialFactsListState);
  });
});

describe("buildFactsListQuery", () => {
  it("omits empty filters", () => {
    expect(buildFactsListQuery(initialFactsListState)).toEqual({
      scope: undefined,
      q: undefined,
      tag: undefined,
    });
  });

  it("forwards filled filters", () => {
    expect(
      buildFactsListQuery({ scope: "club", q: "covers", tag: "team:M" }),
    ).toEqual({ scope: "club", q: "covers", tag: "team:M" });
  });
});

describe("makeFactEditFormState", () => {
  it("returns the initial form when no fact is given", () => {
    expect(makeFactEditFormState(null)).toEqual(initialFactEditFormState);
    expect(makeFactEditFormState(undefined)).toEqual(initialFactEditFormState);
  });

  it("seeds from a fact, JSON-stringifying tags", () => {
    expect(makeFactEditFormState(seed)).toEqual({
      content: "Original content",
      scope: "club",
      confidence: 3,
      permanence: "seasonal",
      tagsText: JSON.stringify({ team: "Mitford CC" }),
    });
  });
});

describe("factEditReducer", () => {
  it("setContent updates only content", () => {
    const next = factEditReducer(initialFactEditFormState, {
      type: "setContent",
      value: "edited",
    });
    expect(next.content).toBe("edited");
  });

  it("setScope updates only scope", () => {
    const next = factEditReducer(initialFactEditFormState, {
      type: "setScope",
      value: "user",
    });
    expect(next.scope).toBe("user");
  });

  it("setConfidence clamps to the 1–5 range", () => {
    expect(
      factEditReducer(initialFactEditFormState, {
        type: "setConfidence",
        value: 0,
      }).confidence,
    ).toBe(1);
    expect(
      factEditReducer(initialFactEditFormState, {
        type: "setConfidence",
        value: 99,
      }).confidence,
    ).toBe(5);
    expect(
      factEditReducer(initialFactEditFormState, {
        type: "setConfidence",
        value: 4,
      }).confidence,
    ).toBe(4);
  });

  it("setPermanence accepts the union including null", () => {
    let s = factEditReducer(initialFactEditFormState, {
      type: "setPermanence",
      value: "permanent",
    });
    expect(s.permanence).toBe("permanent");
    s = factEditReducer(s, { type: "setPermanence", value: null });
    expect(s.permanence).toBeNull();
  });

  it("setTagsText updates only tagsText", () => {
    const next = factEditReducer(initialFactEditFormState, {
      type: "setTagsText",
      value: '{"foo":"bar"}',
    });
    expect(next.tagsText).toBe('{"foo":"bar"}');
  });

  it("reseed replaces the whole state from a fact", () => {
    const dirty = {
      content: "stale",
      scope: "user" as const,
      confidence: 5,
      permanence: "ephemeral" as const,
      tagsText: "{}",
    };
    expect(factEditReducer(dirty, { type: "reseed", fact: seed })).toEqual(
      makeFactEditFormState(seed),
    );
  });

  it("reseed with null returns to the initial state", () => {
    const dirty = makeFactEditFormState(seed);
    expect(factEditReducer(dirty, { type: "reseed", fact: null })).toEqual(
      initialFactEditFormState,
    );
  });
});

describe("parseTagsText", () => {
  it("parses valid JSON", () => {
    expect(parseTagsText('{"team":"M"}')).toEqual({ team: "M" });
  });

  it("throws a friendly error on invalid JSON", () => {
    expect(() => parseTagsText("not json")).toThrow(/valid JSON/);
  });
});

describe("buildFactEditPatch", () => {
  it("omits unchanged fields and always includes tags", () => {
    const patch = buildFactEditPatch(makeFactEditFormState(seed), seed);
    expect(patch).toEqual({
      content: undefined,
      scope: undefined,
      confidence: undefined,
      permanence: undefined,
      tags: { team: "Mitford CC" },
    });
  });

  it("includes only the fields that changed", () => {
    const state = {
      ...makeFactEditFormState(seed),
      content: "new content",
      confidence: 5,
    };
    const patch = buildFactEditPatch(state, seed);
    expect(patch.content).toBe("new content");
    expect(patch.confidence).toBe(5);
    expect(patch.scope).toBeUndefined();
    expect(patch.permanence).toBeUndefined();
    expect(patch.tags).toEqual({ team: "Mitford CC" });
  });

  it("propagates the parse error when tagsText is invalid", () => {
    const state = { ...makeFactEditFormState(seed), tagsText: "not json" };
    expect(() => buildFactEditPatch(state, seed)).toThrow(/valid JSON/);
  });
});
