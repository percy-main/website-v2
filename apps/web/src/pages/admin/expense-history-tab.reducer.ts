/**
 * State + reducer for the Expense History tab filter / pagination cluster.
 *
 * Combines the date range, status, expense-type, search (raw +
 * debounced), and pagination so changing any filter atomically resets
 * page → 1 (no cascading setStates) and "Clear filters" is a single
 * dispatch.
 *
 * The financial-year defaults are date-dependent, so the initial state
 * is built via `makeInitialFiltersState(defaults)` and "clear" carries
 * the defaults so we can return to them rather than to literal "" values.
 *
 * The selected-expense modal, lightbox URL, and exporting flag are kept
 * as plain useState in the component — they're independent overlay /
 * transient UI concerns, not part of the list-filtering state machine.
 */

export interface FinancialYearDefaults {
  dateFrom: string;
  dateTo: string;
}

export interface ExpenseFiltersState {
  page: number;
  status: string;
  expenseType: string;
  search: string;
  debouncedSearch: string;
  dateFrom: string;
  dateTo: string;
}

export function makeInitialExpenseFiltersState(
  defaults: FinancialYearDefaults,
): ExpenseFiltersState {
  return {
    page: 1,
    status: "all",
    expenseType: "all",
    search: "",
    debouncedSearch: "",
    dateFrom: defaults.dateFrom,
    dateTo: defaults.dateTo,
  };
}

export type ExpenseFiltersAction =
  | { type: "setSearch"; value: string }
  | { type: "commitSearch"; value: string }
  | { type: "setStatus"; value: string }
  | { type: "setExpenseType"; value: string }
  | { type: "setDateFrom"; value: string }
  | { type: "setDateTo"; value: string }
  | { type: "setPage"; value: number }
  | { type: "clearFilters"; defaults: FinancialYearDefaults };

export function expenseFiltersReducer(
  state: ExpenseFiltersState,
  action: ExpenseFiltersAction,
): ExpenseFiltersState {
  switch (action.type) {
    case "setSearch":
      return { ...state, search: action.value };
    case "commitSearch":
      return { ...state, debouncedSearch: action.value, page: 1 };
    case "setStatus":
      return { ...state, status: action.value, page: 1 };
    case "setExpenseType":
      return { ...state, expenseType: action.value, page: 1 };
    case "setDateFrom":
      return { ...state, dateFrom: action.value, page: 1 };
    case "setDateTo":
      return { ...state, dateTo: action.value, page: 1 };
    case "setPage":
      return { ...state, page: action.value };
    case "clearFilters":
      return makeInitialExpenseFiltersState(action.defaults);
  }
}

/**
 * True when any filter differs from the default financial-year view —
 * used to decide whether to show the "Clear filters" button.
 */
export function isFiltered(
  state: ExpenseFiltersState,
  defaults: FinancialYearDefaults,
): boolean {
  return (
    state.status !== "all" ||
    state.expenseType !== "all" ||
    state.debouncedSearch !== "" ||
    state.dateFrom !== defaults.dateFrom ||
    state.dateTo !== defaults.dateTo
  );
}

/**
 * Compute the financial-year default date range. UK financial year runs
 * 1 April → 31 March; "now" determines which year we're inside.
 *
 * Pulled out of the component so it can be unit-tested with a fixed
 * `now` and so the reducer can resolve back to it on "clear".
 */
export function getFinancialYearDefaults(now: Date): FinancialYearDefaults {
  const currentMonth = now.getMonth() + 1;
  const year = currentMonth >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    dateFrom: `${year}-04-01`,
    dateTo: `${year + 1}-03-31`,
  };
}
