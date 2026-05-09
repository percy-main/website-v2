import { describe, expect, it } from "vitest";
import {
  initialJuniorsFilterState,
  juniorsFilterReducer,
} from "./juniors-tab.reducer";

describe("juniorsFilterReducer", () => {
  it("starts on page 1 with all filters set to 'all'", () => {
    expect(initialJuniorsFilterState).toEqual({
      page: 1,
      search: "",
      debouncedSearch: "",
      ageGroupFilter: "all",
      sexFilter: "all",
      membershipFilter: "all",
    });
  });

  it("setSearch leaves page and debouncedSearch alone", () => {
    const dirty = { ...initialJuniorsFilterState, page: 4 };
    const next = juniorsFilterReducer(dirty, {
      type: "setSearch",
      value: "smith",
    });
    expect(next.search).toBe("smith");
    expect(next.page).toBe(4);
    expect(next.debouncedSearch).toBe("");
  });

  it("commitSearch resets page and updates debouncedSearch", () => {
    const dirty = { ...initialJuniorsFilterState, page: 8, search: "smith" };
    const next = juniorsFilterReducer(dirty, {
      type: "commitSearch",
      value: "smith",
    });
    expect(next.debouncedSearch).toBe("smith");
    expect(next.page).toBe(1);
  });

  it("setAgeGroupFilter resets page to 1", () => {
    const dirty = { ...initialJuniorsFilterState, page: 3 };
    const next = juniorsFilterReducer(dirty, {
      type: "setAgeGroupFilter",
      value: "U13",
    });
    expect(next.ageGroupFilter).toBe("U13");
    expect(next.page).toBe(1);
  });

  it("setSexFilter resets page to 1", () => {
    const dirty = { ...initialJuniorsFilterState, page: 2 };
    const next = juniorsFilterReducer(dirty, {
      type: "setSexFilter",
      value: "female",
    });
    expect(next.sexFilter).toBe("female");
    expect(next.page).toBe(1);
  });

  it("setMembershipFilter resets page to 1", () => {
    const dirty = { ...initialJuniorsFilterState, page: 5 };
    const next = juniorsFilterReducer(dirty, {
      type: "setMembershipFilter",
      value: "unpaid",
    });
    expect(next.membershipFilter).toBe("unpaid");
    expect(next.page).toBe(1);
  });

  it("setPage updates only page", () => {
    const dirty = {
      ...initialJuniorsFilterState,
      ageGroupFilter: "U11" as const,
      debouncedSearch: "x",
    };
    const next = juniorsFilterReducer(dirty, { type: "setPage", value: 3 });
    expect(next.page).toBe(3);
    expect(next.ageGroupFilter).toBe("U11");
    expect(next.debouncedSearch).toBe("x");
  });

  it("filter changes preserve search input", () => {
    const dirty = {
      ...initialJuniorsFilterState,
      search: "typing",
      debouncedSearch: "typing",
    };
    const next = juniorsFilterReducer(dirty, {
      type: "setSexFilter",
      value: "male",
    });
    expect(next.search).toBe("typing");
    expect(next.debouncedSearch).toBe("typing");
  });
});
