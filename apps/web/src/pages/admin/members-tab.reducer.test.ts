import { describe, expect, it } from "vitest";
import {
  initialMembersFilterState,
  isFiltered,
  membersFilterReducer,
} from "./members-tab.reducer";

describe("membersFilterReducer", () => {
  it("starts on page 1 with empty filters", () => {
    expect(initialMembersFilterState).toEqual({
      page: 1,
      searchInput: "",
      debouncedSearch: "",
      includeArchived: false,
      isMember: "",
      membershipStatus: "",
      membershipType: "",
      memberCategory: "",
      role: "",
    });
  });

  it("setSearchInput updates the raw input without resetting page", () => {
    const dirty = { ...initialMembersFilterState, page: 5 };
    const next = membersFilterReducer(dirty, {
      type: "setSearchInput",
      value: "alice",
    });
    expect(next.searchInput).toBe("alice");
    expect(next.page).toBe(5);
    expect(next.debouncedSearch).toBe("");
  });

  it("commitSearch resets page to 1 and updates debouncedSearch", () => {
    const dirty = { ...initialMembersFilterState, page: 7, searchInput: "bob" };
    const next = membersFilterReducer(dirty, {
      type: "commitSearch",
      value: "bob",
    });
    expect(next.debouncedSearch).toBe("bob");
    expect(next.page).toBe(1);
    expect(next.searchInput).toBe("bob");
  });

  it("setIncludeArchived resets page to 1", () => {
    const dirty = { ...initialMembersFilterState, page: 3 };
    const next = membersFilterReducer(dirty, {
      type: "setIncludeArchived",
      value: true,
    });
    expect(next.includeArchived).toBe(true);
    expect(next.page).toBe(1);
  });

  it("setMembershipStatus to 'none' clears membershipType", () => {
    const dirty = {
      ...initialMembersFilterState,
      membershipType: "senior_player",
      page: 4,
    };
    const next = membersFilterReducer(dirty, {
      type: "setMembershipStatus",
      value: "none",
    });
    expect(next.membershipStatus).toBe("none");
    expect(next.membershipType).toBe("");
    expect(next.page).toBe(1);
  });

  it("setMembershipStatus to non-'none' leaves membershipType intact", () => {
    const dirty = {
      ...initialMembersFilterState,
      membershipType: "senior_player",
    };
    const next = membersFilterReducer(dirty, {
      type: "setMembershipStatus",
      value: "active",
    });
    expect(next.membershipType).toBe("senior_player");
  });

  it("setPage does not reset other state", () => {
    const dirty = { ...initialMembersFilterState, debouncedSearch: "a" };
    const next = membersFilterReducer(dirty, { type: "setPage", value: 3 });
    expect(next.page).toBe(3);
    expect(next.debouncedSearch).toBe("a");
  });

  it("clearFilters returns to initial state", () => {
    const dirty: typeof initialMembersFilterState = {
      page: 5,
      searchInput: "x",
      debouncedSearch: "x",
      includeArchived: true,
      isMember: "true",
      membershipStatus: "active",
      membershipType: "senior_player",
      memberCategory: "senior",
      role: "admin",
    };
    expect(membersFilterReducer(dirty, { type: "clearFilters" })).toEqual(
      initialMembersFilterState,
    );
  });
});

describe("isFiltered", () => {
  it("is false on the initial state", () => {
    expect(isFiltered(initialMembersFilterState)).toBe(false);
  });

  it("is true when any filter is active", () => {
    expect(
      isFiltered({ ...initialMembersFilterState, debouncedSearch: "alice" }),
    ).toBe(true);
    expect(
      isFiltered({ ...initialMembersFilterState, includeArchived: true }),
    ).toBe(true);
    expect(isFiltered({ ...initialMembersFilterState, role: "admin" })).toBe(
      true,
    );
  });

  it("ignores raw searchInput (only debouncedSearch counts)", () => {
    expect(
      isFiltered({ ...initialMembersFilterState, searchInput: "typing" }),
    ).toBe(false);
  });
});
