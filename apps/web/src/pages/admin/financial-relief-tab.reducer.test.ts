import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  filtersFromSearchParams,
  filtersToSearchParams,
} from "./financial-relief-tab.reducer";

describe("financial-relief filters", () => {
  it("round-trips defaults to a minimal URL", () => {
    const params = filtersToSearchParams(DEFAULT_FILTERS);
    expect(params.get("section")).toBe("finance");
    expect(params.get("sub")).toBe("financial-relief");
    expect(params.get("status")).toBeNull();
    expect(params.get("page")).toBeNull();
    expect(params.get("search")).toBeNull();
  });

  it("encodes non-default filters", () => {
    const params = filtersToSearchParams({
      page: 3,
      pageSize: 20,
      status: "in_review",
      search: "Smith",
    });
    expect(params.get("status")).toBe("in_review");
    expect(params.get("page")).toBe("3");
    expect(params.get("search")).toBe("Smith");
  });

  it("parses search params into a filters state, falling back to defaults", () => {
    const params = new URLSearchParams("status=approved&page=2&search=Foo");
    expect(filtersFromSearchParams(params)).toEqual({
      page: 2,
      pageSize: DEFAULT_FILTERS.pageSize,
      status: "approved",
      search: "Foo",
    });
  });

  it("rejects unknown status values", () => {
    const params = new URLSearchParams("status=nonsense");
    expect(filtersFromSearchParams(params).status).toBe("all");
  });

  it("clamps invalid page values to 1", () => {
    const params = new URLSearchParams("page=-3");
    expect(filtersFromSearchParams(params).page).toBe(1);
  });
});
