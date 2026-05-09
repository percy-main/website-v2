/**
 * State + reducer for the Juniors admin tab filter / pagination cluster.
 *
 * Combines search (raw + debounced), pagination, and the age-group / sex
 * / membership filter dropdowns. Filter changes always reset page → 1
 * atomically so a stale page number doesn't survive into a re-filtered
 * result set.
 *
 * The selected-junior dialog is kept as plain useState in the component —
 * it's an independent overlay UI concern, not part of the list-filtering
 * state machine.
 */

import type { AgeGroup } from "@percy-main/shared";

export type MembershipFilter = "all" | "paid" | "unpaid";
export type SexFilter = "all" | "male" | "female";

export interface JuniorsFilterState {
  page: number;
  search: string;
  debouncedSearch: string;
  ageGroupFilter: AgeGroup | "all";
  sexFilter: SexFilter;
  membershipFilter: MembershipFilter;
}

export const initialJuniorsFilterState: JuniorsFilterState = {
  page: 1,
  search: "",
  debouncedSearch: "",
  ageGroupFilter: "all",
  sexFilter: "all",
  membershipFilter: "all",
};

export type JuniorsFilterAction =
  | { type: "setSearch"; value: string }
  | { type: "commitSearch"; value: string }
  | { type: "setAgeGroupFilter"; value: AgeGroup | "all" }
  | { type: "setSexFilter"; value: SexFilter }
  | { type: "setMembershipFilter"; value: MembershipFilter }
  | { type: "setPage"; value: number };

export function juniorsFilterReducer(
  state: JuniorsFilterState,
  action: JuniorsFilterAction,
): JuniorsFilterState {
  switch (action.type) {
    case "setSearch":
      return { ...state, search: action.value };
    case "commitSearch":
      return { ...state, debouncedSearch: action.value, page: 1 };
    case "setAgeGroupFilter":
      return { ...state, ageGroupFilter: action.value, page: 1 };
    case "setSexFilter":
      return { ...state, sexFilter: action.value, page: 1 };
    case "setMembershipFilter":
      return { ...state, membershipFilter: action.value, page: 1 };
    case "setPage":
      return { ...state, page: action.value };
  }
}
