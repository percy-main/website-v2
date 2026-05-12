import { REQUEST_STATUSES, type RequestStatus } from "@percy-main/shared";

export type StatusFilter = RequestStatus | "all";

export const STATUS_FILTERS = ["all", ...REQUEST_STATUSES] as const;

export interface FiltersState {
  page: number;
  pageSize: number;
  status: StatusFilter;
  search: string;
}

export const DEFAULT_FILTERS: FiltersState = {
  page: 1,
  pageSize: 20,
  status: "all",
  search: "",
};

function isStatusFilter(value: string | null): value is StatusFilter {
  return !!value && STATUS_FILTERS.includes(value as StatusFilter);
}

export function filtersFromSearchParams(params: URLSearchParams): FiltersState {
  const pageRaw = Number(params.get("page"));
  const status = params.get("status");
  return {
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
    pageSize: DEFAULT_FILTERS.pageSize,
    status: isStatusFilter(status) ? status : "all",
    search: params.get("search") ?? "",
  };
}

/**
 * Pure helper used by tests + the admin tab: builds the URLSearchParams
 * patch (only including non-default values, so the URL stays clean) for
 * the admin-panel section/sub-tab plus the relief-specific filter state.
 */
export function filtersToSearchParams(filters: FiltersState): URLSearchParams {
  const params = new URLSearchParams();
  // The admin-panel root keys must come along so direct linking lands
  // on the right tab.
  params.set("section", "finance");
  params.set("sub", "financial-relief");
  if (filters.status !== DEFAULT_FILTERS.status) {
    params.set("status", filters.status);
  }
  if (filters.search) params.set("search", filters.search);
  if (filters.page !== DEFAULT_FILTERS.page) {
    params.set("page", String(filters.page));
  }
  return params;
}
