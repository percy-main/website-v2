/**
 * State + reducer for the Charges admin tab filter / pagination cluster.
 *
 * Combines status, date-range, search (raw + debounced), show-deleted
 * toggle, and pagination so a "Clear filters" press is a single dispatch
 * and so filter changes can atomically reset page → 1 (no cascading
 * setState pairs).
 *
 * The chasing-charge id (which row's "Chase" button is in confirm mode)
 * is kept as plain useState in the component — it's a transient
 * per-row UI concern, not part of the list-filtering state machine.
 */

export type ChargeStatus = "all" | "unpaid" | "pending" | "paid" | "abandoned";

export interface ChargesFilterState {
  page: number;
  status: ChargeStatus;
  showDeleted: boolean;
  dateFrom: string;
  dateTo: string;
  search: string;
  debouncedSearch: string;
}

export const initialChargesFilterState: ChargesFilterState = {
  page: 1,
  status: "all",
  showDeleted: false,
  dateFrom: "",
  dateTo: "",
  search: "",
  debouncedSearch: "",
};

export type ChargesFilterAction =
  | { type: "setSearch"; value: string }
  | { type: "commitSearch"; value: string }
  | { type: "setStatus"; value: ChargeStatus }
  | { type: "setShowDeleted"; value: boolean }
  | { type: "setDateFrom"; value: string }
  | { type: "setDateTo"; value: string }
  | { type: "setPage"; value: number }
  | { type: "clearFilters" };

export function chargesFilterReducer(
  state: ChargesFilterState,
  action: ChargesFilterAction,
): ChargesFilterState {
  switch (action.type) {
    case "setSearch":
      return { ...state, search: action.value };
    case "commitSearch":
      return { ...state, debouncedSearch: action.value, page: 1 };
    case "setStatus":
      return { ...state, status: action.value, page: 1 };
    case "setShowDeleted":
      return { ...state, showDeleted: action.value, page: 1 };
    case "setDateFrom":
      return { ...state, dateFrom: action.value, page: 1 };
    case "setDateTo":
      return { ...state, dateTo: action.value, page: 1 };
    case "setPage":
      return { ...state, page: action.value };
    case "clearFilters":
      return initialChargesFilterState;
  }
}

/**
 * True when any filter is active — used to decide whether to show the
 * "Clear filters" button.
 */
export function isFiltered(state: ChargesFilterState): boolean {
  return (
    state.dateFrom !== "" ||
    state.dateTo !== "" ||
    state.search !== "" ||
    state.status !== "all" ||
    state.showDeleted
  );
}
