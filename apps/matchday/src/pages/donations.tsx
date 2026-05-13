import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import { fmtDate, fmtMoneyPence } from "@/features/format.js";
import { api, callApi } from "@/lib/api-client.js";
import { mainSiteUrl } from "@/lib/main-site.js";
import { cn } from "@/lib/utils.js";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

type Tab = "outstanding" | "history";

interface ChargeRow {
  id: string;
  amountPence: number | string;
  description?: string | null;
  matchDate?: string | null;
  opposition?: string | null;
  category?: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  relievedAt: string | null;
  createdAt: string | null;
}

/**
 * Donations view. Total + history.
 *
 * Per the plan, payment stays on the main site — we view here, deep-link
 * to `/members/charges` (Stripe) for the actual settlement. PR #297 means
 * user-facing copy is "donation" not "fee" from day one.
 */
export default function Donations() {
  const [tab, setTab] = useState<Tab>("outstanding");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["charges"],
    queryFn: () => callApi(api.GET("/api/charges")),
  });
  const charges =
    (data as unknown as { charges?: ChargeRow[] } | undefined)?.charges ?? [];
  const outstanding = charges.filter(
    (c) => !c.paidAt && !c.voidedAt && !c.relievedAt,
  );
  const history = charges
    .filter((c) => c.paidAt ?? c.voidedAt ?? c.relievedAt)
    .sort((a, b) =>
      (b.paidAt ?? b.createdAt ?? "").localeCompare(
        a.paidAt ?? a.createdAt ?? "",
      ),
    );
  const total = outstanding.reduce(
    (acc, c) => acc + (Number(c.amountPence) || 0),
    0,
  );
  return (
    <div className="mx-auto w-full max-w-2xl pb-6">
      <header className="px-4 pb-4 pt-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
          You owe
        </p>
        <p className="mt-1 text-4xl font-bold tracking-[-0.02em] text-navy dark:text-white">
          {fmtMoneyPence(total)}
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          {outstanding.length === 0
            ? "Nothing outstanding. Cheers."
            : `${outstanding.length} unpaid match donation${outstanding.length === 1 ? "" : "s"}`}
        </p>
        {outstanding.length > 0 && (
          <Button asChild tone="primary" className="mt-3 w-full">
            <a
              href={mainSiteUrl("/members/charges")}
              target="_blank"
              rel="noopener"
            >
              Pay on main site ↗
            </a>
          </Button>
        )}
        <p className="mt-2 text-xs text-text-muted">
          Payments are handled by Stripe on the main Percy Main site.
        </p>
      </header>

      <div className="mx-4 grid grid-cols-2 gap-1 rounded-xl bg-surface-raised p-1">
        <TabBtn active={tab === "outstanding"} onClick={() => setTab("outstanding")}>
          Outstanding ({outstanding.length})
        </TabBtn>
        <TabBtn active={tab === "history"} onClick={() => setTab("history")}>
          History ({history.length})
        </TabBtn>
      </div>

      <div className="mt-1">
        {isLoading && <ChargeSkeleton />}
        {isError && (
          <p className="px-4 py-6 text-sm text-text-secondary">
            Couldn't load donations. Try again.
          </p>
        )}
        {!isLoading && !isError && tab === "outstanding" && (
          <>
            {outstanding.length === 0 ? (
              <EmptyState
                title="No outstanding donations"
                body="Everything is up to date."
              />
            ) : (
              outstanding.map((c) => <ChargeRowItem key={c.id} c={c} />)
            )}
          </>
        )}
        {!isLoading && !isError && tab === "history" && (
          <>
            {history.length === 0 ? (
              <EmptyState
                title="No history yet"
                body="Your paid donations will show here."
              />
            ) : (
              history.map((c) => <ChargeRowItem key={c.id} c={c} muted />)
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg py-2 text-sm font-semibold transition-colors",
        active
          ? "bg-surface text-navy shadow-sm dark:text-white"
          : "text-text-secondary",
      )}
    >
      {children}
    </button>
  );
}

function ChargeRowItem({ c, muted }: { c: ChargeRow; muted?: boolean }) {
  const overdue = !c.paidAt && !c.voidedAt && !c.relievedAt && isOverdue(c);
  const status = c.paidAt
    ? { tone: "success" as const, label: `Paid ${fmtDate(c.paidAt)}` }
    : c.voidedAt
      ? { tone: "neutral" as const, label: "Voided" }
      : c.relievedAt
        ? { tone: "warning" as const, label: "Relieved" }
        : null;
  return (
    <div
      className={cn(
        "grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t border-border-light px-4 py-3",
        muted && "opacity-70",
      )}
    >
      {c.matchDate ? (
        <div className="flex flex-col items-center justify-center rounded-md bg-surface-raised py-1">
          <div className="text-base font-bold leading-none text-navy dark:text-white">
            {new Date(c.matchDate).getDate()}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-text-secondary">
            {fmtDate(c.matchDate, "MMM")}
          </div>
        </div>
      ) : (
        <span className="size-11" />
      )}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          {c.opposition ? `vs ${c.opposition}` : (c.description ?? "Match donation")}
        </div>
        <div className="mt-0.5 text-xs text-text-secondary">
          {[c.category, c.matchDate ? fmtDate(c.matchDate) : null]
            .filter(Boolean)
            .join(" · ")}
          {overdue && (
            <span className="ml-2 font-medium text-danger">
              Overdue · 14+ days
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end">
        <div
          className={cn(
            "text-[15px] font-bold tracking-[-0.005em]",
            overdue ? "text-danger" : "text-navy dark:text-white",
          )}
        >
          {fmtMoneyPence(c.amountPence)}
        </div>
        {status && (
          <StatusPill tone={status.tone} className="mt-1">
            {status.label}
          </StatusPill>
        )}
      </div>
    </div>
  );
}

function ChargeSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {["a", "b", "c"].map((slot) => (
        <div key={slot} className="flex items-center gap-3">
          <div className="size-11 rounded-md bg-border" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 rounded-md bg-border" />
            <div className="h-3 w-1/2 rounded-md bg-border-light" />
          </div>
          <div className="h-5 w-12 rounded-md bg-border" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm text-text-secondary">{body}</p>
    </div>
  );
}

function isOverdue(c: ChargeRow): boolean {
  if (!c.createdAt) return false;
  return (Date.now() - new Date(c.createdAt).getTime()) / 86_400_000 > 14;
}
