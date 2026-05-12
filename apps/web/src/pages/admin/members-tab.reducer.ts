/**
 * State + reducer for the Members admin tab filter / pagination cluster.
 *
 * Co-locates the search (raw + debounced), pagination, and individual
 * filter dropdowns so that filter changes can atomically reset page → 1
 * without spawning cascading setState calls.
 *
 * The detail-modal selection (`selectedUserId`) is intentionally kept as
 * plain useState in the component — it's an independent overlay UI
 * concern, not part of the list-filtering state machine.
 */

export interface MembersFilterState {
  page: number;
  searchInput: string;
  debouncedSearch: string;
  includeArchived: boolean;
  membershipStatus: string;
  membershipType: string;
  memberCategory: string;
  role: string;
}

export const initialMembersFilterState: MembersFilterState = {
  page: 1,
  searchInput: "",
  debouncedSearch: "",
  includeArchived: false,
  membershipStatus: "",
  membershipType: "",
  memberCategory: "",
  role: "",
};

export type MembersFilterAction =
  | { type: "setSearchInput"; value: string }
  | { type: "commitSearch"; value: string }
  | { type: "setIncludeArchived"; value: boolean }
  | { type: "setMembershipStatus"; value: string }
  | { type: "setMembershipType"; value: string }
  | { type: "setMemberCategory"; value: string }
  | { type: "setRole"; value: string }
  | { type: "setPage"; value: number }
  | { type: "clearFilters" };

export function membersFilterReducer(
  state: MembersFilterState,
  action: MembersFilterAction,
): MembersFilterState {
  switch (action.type) {
    case "setSearchInput":
      return { ...state, searchInput: action.value };
    case "commitSearch":
      // Debounced: applying the search resets pagination so users see page 1
      // of the new query result, not whatever page they were on before.
      return { ...state, debouncedSearch: action.value, page: 1 };
    case "setIncludeArchived":
      return { ...state, includeArchived: action.value, page: 1 };
    case "setMembershipStatus": {
      // Selecting "none" disables type filter — clear it atomically here
      // rather than leaving a stale value behind.
      const next = { ...state, membershipStatus: action.value, page: 1 };
      if (action.value === "none") next.membershipType = "";
      return next;
    }
    case "setMembershipType":
      return { ...state, membershipType: action.value, page: 1 };
    case "setMemberCategory":
      return { ...state, memberCategory: action.value, page: 1 };
    case "setRole":
      return { ...state, role: action.value, page: 1 };
    case "setPage":
      return { ...state, page: action.value };
    case "clearFilters":
      return initialMembersFilterState;
  }
}

/**
 * True when any filter (search, archived, status, type, etc.) is active —
 * used to decide whether to show the "Clear filters" button.
 */
export function isFiltered(state: MembersFilterState): boolean {
  return (
    state.debouncedSearch !== "" ||
    state.includeArchived ||
    state.membershipStatus !== "" ||
    state.membershipType !== "" ||
    state.memberCategory !== "" ||
    state.role !== ""
  );
}
