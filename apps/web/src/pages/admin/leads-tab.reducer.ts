/**
 * State + reducer for the Leads admin tab filters / pagination cluster.
 *
 * Combines search (raw + debounced), pagination, and the campaign /
 * segment / status / source dropdowns. Pagination resets to page 1 on
 * any filter change so users always see "page 1 of the new query".
 *
 * The expanded-row id and the joined-modal lead id are kept as plain
 * useState in the component — they're independent overlay UI concerns,
 * not part of the list-filtering state machine.
 */

export interface LeadsFilterState {
  page: number;
  search: string;
  debouncedSearch: string;
  campaignId: string;
  segment: string;
  status: string;
  source: string;
}

export const initialLeadsFilterState: LeadsFilterState = {
  page: 1,
  search: "",
  debouncedSearch: "",
  campaignId: "",
  segment: "",
  status: "",
  source: "",
};

export type LeadsFilterAction =
  | { type: "setSearch"; value: string }
  | { type: "commitSearch"; value: string }
  | { type: "setCampaignId"; value: string }
  | { type: "setSegment"; value: string }
  | { type: "setStatus"; value: string }
  | { type: "setSource"; value: string }
  | { type: "setPage"; value: number };

export function leadsFilterReducer(
  state: LeadsFilterState,
  action: LeadsFilterAction,
): LeadsFilterState {
  switch (action.type) {
    case "setSearch":
      return { ...state, search: action.value };
    case "commitSearch":
      return { ...state, debouncedSearch: action.value, page: 1 };
    case "setCampaignId":
      // Switching campaign clears the segment filter atomically — segments
      // are scoped per campaign so the old value is meaningless.
      return { ...state, campaignId: action.value, segment: "", page: 1 };
    case "setSegment":
      return { ...state, segment: action.value, page: 1 };
    case "setStatus":
      return { ...state, status: action.value, page: 1 };
    case "setSource":
      return { ...state, source: action.value, page: 1 };
    case "setPage":
      return { ...state, page: action.value };
  }
}
