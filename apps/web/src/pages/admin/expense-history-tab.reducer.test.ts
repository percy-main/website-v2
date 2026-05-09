import { describe, expect, it } from "vitest";
import {
  expenseFiltersReducer,
  getFinancialYearDefaults,
  isFiltered,
  makeInitialExpenseFiltersState,
} from "./expense-history-tab.reducer";

const defaults = { dateFrom: "2026-04-01", dateTo: "2027-03-31" };
const initial = makeInitialExpenseFiltersState(defaults);

describe("makeInitialExpenseFiltersState", () => {
  it("seeds defaults into dateFrom/dateTo and zeroes other filters", () => {
    expect(initial).toEqual({
      page: 1,
      status: "all",
      expenseType: "all",
      search: "",
      debouncedSearch: "",
      dateFrom: "2026-04-01",
      dateTo: "2027-03-31",
    });
  });
});

describe("expenseFiltersReducer", () => {
  it("setSearch leaves page alone", () => {
    const dirty = { ...initial, page: 4 };
    const next = expenseFiltersReducer(dirty, {
      type: "setSearch",
      value: "umpire",
    });
    expect(next.search).toBe("umpire");
    expect(next.page).toBe(4);
  });

  it("commitSearch resets page", () => {
    const dirty = { ...initial, page: 7, search: "umpire" };
    const next = expenseFiltersReducer(dirty, {
      type: "commitSearch",
      value: "umpire",
    });
    expect(next.debouncedSearch).toBe("umpire");
    expect(next.page).toBe(1);
  });

  it("setStatus / setExpenseType reset page", () => {
    let s = expenseFiltersReducer(
      { ...initial, page: 5 },
      { type: "setStatus", value: "approved" },
    );
    expect(s.status).toBe("approved");
    expect(s.page).toBe(1);

    s = expenseFiltersReducer(
      { ...s, page: 6 },
      { type: "setExpenseType", value: "umpire_fee" },
    );
    expect(s.expenseType).toBe("umpire_fee");
    expect(s.page).toBe(1);
  });

  it("setDateFrom / setDateTo reset page", () => {
    let s = expenseFiltersReducer(
      { ...initial, page: 8 },
      { type: "setDateFrom", value: "2025-01-01" },
    );
    expect(s.dateFrom).toBe("2025-01-01");
    expect(s.page).toBe(1);

    s = expenseFiltersReducer(
      { ...s, page: 9 },
      { type: "setDateTo", value: "2025-12-31" },
    );
    expect(s.dateTo).toBe("2025-12-31");
    expect(s.page).toBe(1);
  });

  it("setPage updates only page", () => {
    const dirty = { ...initial, status: "approved", debouncedSearch: "x" };
    const next = expenseFiltersReducer(dirty, { type: "setPage", value: 5 });
    expect(next.page).toBe(5);
    expect(next.status).toBe("approved");
    expect(next.debouncedSearch).toBe("x");
  });

  it("clearFilters returns to defaults (not literal empty strings)", () => {
    const dirty: typeof initial = {
      page: 7,
      status: "rejected",
      expenseType: "teas",
      search: "x",
      debouncedSearch: "x",
      dateFrom: "2024-01-01",
      dateTo: "2024-12-31",
    };
    expect(
      expenseFiltersReducer(dirty, { type: "clearFilters", defaults }),
    ).toEqual(initial);
  });
});

describe("isFiltered", () => {
  it("is false on the initial state", () => {
    expect(isFiltered(initial, defaults)).toBe(false);
  });

  it("is true when status is non-default", () => {
    expect(isFiltered({ ...initial, status: "approved" }, defaults)).toBe(true);
  });

  it("is true when date range differs from defaults", () => {
    expect(isFiltered({ ...initial, dateFrom: "2025-01-01" }, defaults)).toBe(
      true,
    );
    expect(isFiltered({ ...initial, dateTo: "2025-01-01" }, defaults)).toBe(
      true,
    );
  });

  it("is true when debouncedSearch is set", () => {
    expect(isFiltered({ ...initial, debouncedSearch: "x" }, defaults)).toBe(
      true,
    );
  });

  it("ignores raw search (only debounced counts)", () => {
    expect(isFiltered({ ...initial, search: "typing" }, defaults)).toBe(false);
  });
});

describe("getFinancialYearDefaults", () => {
  it("returns same year April → next year March when in/after April", () => {
    expect(getFinancialYearDefaults(new Date("2026-04-01T00:00:00Z"))).toEqual({
      dateFrom: "2026-04-01",
      dateTo: "2027-03-31",
    });
    expect(getFinancialYearDefaults(new Date("2026-09-15T00:00:00Z"))).toEqual({
      dateFrom: "2026-04-01",
      dateTo: "2027-03-31",
    });
  });

  it("rolls back a year when before April", () => {
    expect(getFinancialYearDefaults(new Date("2026-03-31T00:00:00Z"))).toEqual({
      dateFrom: "2025-04-01",
      dateTo: "2026-03-31",
    });
    expect(getFinancialYearDefaults(new Date("2026-01-15T00:00:00Z"))).toEqual({
      dateFrom: "2025-04-01",
      dateTo: "2026-03-31",
    });
  });
});
