import { describe, expect, it } from "vitest";
import {
  initialLeadsFilterState,
  leadsFilterReducer,
} from "./leads-tab.reducer";

describe("leadsFilterReducer", () => {
  it("starts on page 1 with empty filters", () => {
    expect(initialLeadsFilterState).toEqual({
      page: 1,
      search: "",
      debouncedSearch: "",
      campaignId: "",
      segment: "",
      status: "",
      source: "",
    });
  });

  it("setSearch updates only the raw search input", () => {
    const dirty = { ...initialLeadsFilterState, page: 4 };
    const next = leadsFilterReducer(dirty, {
      type: "setSearch",
      value: "alice",
    });
    expect(next.search).toBe("alice");
    expect(next.page).toBe(4);
    expect(next.debouncedSearch).toBe("");
  });

  it("commitSearch resets page and updates debouncedSearch", () => {
    const dirty = { ...initialLeadsFilterState, page: 9, search: "bob" };
    const next = leadsFilterReducer(dirty, {
      type: "commitSearch",
      value: "bob",
    });
    expect(next.debouncedSearch).toBe("bob");
    expect(next.page).toBe(1);
  });

  it("setCampaignId clears the segment filter", () => {
    const dirty = {
      ...initialLeadsFilterState,
      campaignId: "old",
      segment: "lapsed-juniors",
      page: 3,
    };
    const next = leadsFilterReducer(dirty, {
      type: "setCampaignId",
      value: "new",
    });
    expect(next.campaignId).toBe("new");
    expect(next.segment).toBe("");
    expect(next.page).toBe(1);
  });

  it("setCampaignId to empty also clears segment", () => {
    const dirty = {
      ...initialLeadsFilterState,
      campaignId: "old",
      segment: "lapsed-juniors",
    };
    const next = leadsFilterReducer(dirty, {
      type: "setCampaignId",
      value: "",
    });
    expect(next.segment).toBe("");
  });

  it("setSegment resets page to 1", () => {
    const dirty = { ...initialLeadsFilterState, page: 5 };
    const next = leadsFilterReducer(dirty, {
      type: "setSegment",
      value: "lapsed",
    });
    expect(next.segment).toBe("lapsed");
    expect(next.page).toBe(1);
  });

  it("setStatus resets page to 1", () => {
    const dirty = { ...initialLeadsFilterState, page: 5 };
    const next = leadsFilterReducer(dirty, {
      type: "setStatus",
      value: "joined",
    });
    expect(next.status).toBe("joined");
    expect(next.page).toBe(1);
  });

  it("setSource resets page to 1", () => {
    const dirty = { ...initialLeadsFilterState, page: 7 };
    const next = leadsFilterReducer(dirty, {
      type: "setSource",
      value: "contact_form",
    });
    expect(next.source).toBe("contact_form");
    expect(next.page).toBe(1);
  });

  it("setPage updates only the page number", () => {
    const dirty = {
      ...initialLeadsFilterState,
      debouncedSearch: "alice",
      campaignId: "c1",
    };
    const next = leadsFilterReducer(dirty, { type: "setPage", value: 4 });
    expect(next.page).toBe(4);
    expect(next.debouncedSearch).toBe("alice");
    expect(next.campaignId).toBe("c1");
  });
});
