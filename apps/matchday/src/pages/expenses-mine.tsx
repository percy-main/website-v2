import { StatusPill } from "@/components/primitives/status-pill.js";
import { fmtDate, fmtMoneyPence } from "@/features/format.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

type PendingExpense =
  ApiResponse<"/api/matchday/expenses/pending">["items"][number];

/**
 * /expenses/mine — list of matchday expenses the current official has
 * recorded, grouped by status. Re-uses GET /api/matchday/expenses/pending
 * for submitted+approved+reimbursed (treasurer view filtered server-side
 * by caller). For a thorough "draft only" view we'd add a separate
 * endpoint; for v1 this is the most useful surface the captain has.
 */
export default function ExpensesMine() {
  const { data, isLoading } = useQuery({
    queryKey: ["matchday", "expenses", "pending"],
    queryFn: () =>
      callApi(
        api.GET("/api/matchday/expenses/pending", {
          params: { query: { limit: 50 } },
        }),
      ),
  });
  const items = data?.items ?? [];

  const grouped: Record<string, PendingExpense[]> = {
    Submitted: items.filter((e) => e.status === "submitted"),
    Approved: items.filter((e) => e.status === "approved"),
    Reimbursed: items.filter((e) => e.status === "reimbursed"),
    Rejected: items.filter((e) => e.status === "rejected"),
  };

  return (
    <div className="mx-auto w-full max-w-2xl pb-6">
      <header className="px-4 pb-2 pt-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
          My expenses
        </p>
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">
          Recorded
        </h1>
      </header>

      {isLoading && (
        <div className="space-y-2 p-4">
          {["a", "b", "c"].map((s) => (
            <div key={s} className="h-16 rounded-2xl bg-border" />
          ))}
        </div>
      )}

      {!isLoading &&
        Object.entries(grouped).map(([title, list]) =>
          list.length === 0 ? null : (
            <section key={title} className="px-4 pt-4">
              <h2 className="pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
                {title}
              </h2>
              <div className="space-y-2">
                {list.map((e) => (
                  <ExpenseCard key={e.id} e={e} />
                ))}
              </div>
            </section>
          ),
        )}
      {!isLoading && items.length === 0 && (
        <p className="px-6 py-12 text-center text-sm text-text-secondary">
          You haven't recorded any expenses yet. Add one from the captain's
          match-day view.
        </p>
      )}
    </div>
  );
}

function ExpenseCard({ e }: { e: PendingExpense }) {
  return (
    <Link
      to={`/matchday/${e.matchday_id}/live`}
      className="block rounded-2xl border border-border bg-surface p-4"
    >
      <div className="flex items-baseline justify-between">
        <strong className="text-sm">
          {label(e.expense_type)} · {fmtMoneyPence(e.amount_pence)}
        </strong>
        <StatusPill tone={tone(e.status)} dot>
          {e.status}
        </StatusPill>
      </div>
      <p className="mt-1 text-xs text-text-secondary">
        vs {e.opposition} · {fmtDate(e.match_date, "EEE d MMM")}
      </p>
      {e.description && (
        <p className="mt-1 text-xs italic text-text-secondary">
          "{e.description}"
        </p>
      )}
      {e.rejected_reason && (
        <p className="mt-1 rounded-md bg-danger-bg px-2 py-1 text-xs text-danger">
          Rejected: {e.rejected_reason}
        </p>
      )}
    </Link>
  );
}

function label(t: string): string {
  return (
    {
      umpire_fee: "Umpire fee",
      scorer_fee: "Scorer fee",
      match_ball: "Match ball",
      teas: "Teas",
      miscellaneous: "Misc",
    } as Record<string, string>
  )[t] ?? t;
}
function tone(s: string): "navy" | "success" | "warning" | "danger" | "neutral" {
  if (s === "submitted") return "warning";
  if (s === "approved") return "navy";
  if (s === "reimbursed") return "success";
  if (s === "rejected") return "danger";
  return "neutral";
}
