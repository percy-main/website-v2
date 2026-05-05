import { api, callApi } from "@/lib/api-client";
import type { ReportData } from "@percy-main/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const POLL_INTERVAL_MS = 5_000;

const reportDetailKey = (reportId: string) =>
  ["scout", "report", reportId] as const;

/**
 * Live report state for the pipeline card. Polls
 * `GET /api/scout/reports/:reportId` every 5s while the report is in flight
 * (status === "queued" / "generating") and stops at any terminal state
 * (ready / failed). The card mounts immediately from the streamed
 * data-report part and swaps in this query's data on the first successful
 * poll, so reloads of an old thread also surface live state without needing
 * a fresh chat turn.
 */
export function useReportDetail(reportId: string) {
  return useQuery({
    queryKey: reportDetailKey(reportId),
    queryFn: () =>
      callApi(
        api.GET("/api/scout/reports/{reportId}", {
          params: { path: { reportId } },
        }),
      ) as Promise<ReportData>,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status === "ready" || status === "failed") return false;
      return POLL_INTERVAL_MS;
    },
    // Once the report reaches a terminal state we want react-query to keep
    // the cached value indefinitely — no auto-refetch on focus, no stale
    // re-trigger that would un-stop the poll.
    staleTime: Infinity,
  });
}

export function useCancelReport(reportId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/scout/reports/{reportId}/cancel", {
          params: { path: { reportId } },
        }),
      ),
    onSuccess: () => {
      // The next poll (≤5s) will see status='failed' once the worker's
      // flush picks up the cancel flag. Trigger a refetch immediately so
      // the FE doesn't sit on stale "generating" state for up to 5s.
      void qc.invalidateQueries({ queryKey: reportDetailKey(reportId) });
    },
  });
}
