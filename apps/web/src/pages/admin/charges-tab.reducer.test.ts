import { describe, expect, it } from "vitest";
import {
  chargesFilterReducer,
  initialChargesFilterState,
  isFiltered,
} from "./charges-tab.reducer";

describe("chargesFilterReducer", () => {
  it("starts on page 1 with status 'all' and no filters", () => {
    expect(initialChargesFilterState).toEqual({
      page: 1,
      status: "all",
      showDeleted: false,
      dateFrom: "",
      dateTo: "",
      search: "",
      debouncedSearch: "",
    });
  });

  it("setSearch leaves page alone", () => {
    const dirty = { ...initialChargesFilterState, page: 4 };
    const next = chargesFilterReducer(dirty, {
      type: "setSearch",
      value: "alice",
    });
    expect(next.search).toBe("alice");
    expect(next.page).toBe(4);
    expect(next.debouncedSearch).toBe("");
  });

  it("commitSearch updates debounced value and resets page", () => {
    const dirty = { ...initialChargesFilterState, page: 7, search: "alice" };
    const next = chargesFilterReducer(dirty, {
      type: "commitSearch",
      value: "alice",
    });
    expect(next.debouncedSearch).toBe("alice");
    expect(next.page).toBe(1);
  });

  it("setStatus resets page to 1", () => {
    const dirty = { ...initialChargesFilterState, page: 5 };
    const next = chargesFilterReducer(dirty, {
      type: "setStatus",
      value: "unpaid",
    });
    expect(next.status).toBe("unpaid");
    expect(next.page).toBe(1);
  });

  it("setDateFrom and setDateTo reset page", () => {
    let s = chargesFilterReducer(
      { ...initialChargesFilterState, page: 3 },
      { type: "setDateFrom", value: "2026-01-01" },
    );
    expect(s.dateFrom).toBe("2026-01-01");
    expect(s.page).toBe(1);

    s = chargesFilterReducer(
      { ...s, page: 4 },
      { type: "setDateTo", value: "2026-12-31" },
    );
    expect(s.dateTo).toBe("2026-12-31");
    expect(s.page).toBe(1);
  });

  it("setShowDeleted resets page", () => {
    const dirty = { ...initialChargesFilterState, page: 6 };
    const next = chargesFilterReducer(dirty, {
      type: "setShowDeleted",
      value: true,
    });
    expect(next.showDeleted).toBe(true);
    expect(next.page).toBe(1);
  });

  it("setPage updates only page", () => {
    const dirty = {
      ...initialChargesFilterState,
      status: "paid" as const,
      debouncedSearch: "alice",
    };
    const next = chargesFilterReducer(dirty, { type: "setPage", value: 3 });
    expect(next.page).toBe(3);
    expect(next.status).toBe("paid");
    expect(next.debouncedSearch).toBe("alice");
  });

  it("clearFilters returns to initial state", () => {
    const dirty: typeof initialChargesFilterState = {
      page: 9,
      status: "abandoned",
      showDeleted: true,
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      search: "alice",
      debouncedSearch: "alice",
    };
    expect(chargesFilterReducer(dirty, { type: "clearFilters" })).toEqual(
      initialChargesFilterState,
    );
  });
});

describe("isFiltered", () => {
  it("is false on initial state", () => {
    expect(isFiltered(initialChargesFilterState)).toBe(false);
  });

  it("is true when status is not 'all'", () => {
    expect(
      isFiltered({ ...initialChargesFilterState, status: "paid" }),
    ).toBe(true);
  });

  it("is true when any filter is set", () => {
    expect(
      isFiltered({ ...initialChargesFilterState, dateFrom: "2026-01-01" }),
    ).toBe(true);
    expect(
      isFiltered({ ...initialChargesFilterState, search: "alice" }),
    ).toBe(true);
    expect(
      isFiltered({ ...initialChargesFilterState, showDeleted: true }),
    ).toBe(true);
  });
});
