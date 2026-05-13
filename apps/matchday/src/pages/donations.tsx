import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import { fmtDate, fmtMoneyPence } from "@/features/format.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { mainSiteUrl } from "@/lib/main-site.js";
import { cn } from "@/lib/utils.js";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

type Tab = "outstanding" | "history";

type ChargesResponse = ApiResponse<"/api/charges">;
type Charge = ChargesResponse["charges"][number];

function isOpen(c: Charge): boolean {
  return !c.paid_at && !c.deleted_at && !c.relieved_at;
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
  const charges = data?.charges ?? [];
  const outstanding = charges.filter(isOpen);
  const history = charges
    .filter((c) => !isOpen(c))
    .sort((a, b) =>
      (b.paid_at ?? b.created_at).localeCompare(a.paid_at ?? a.created_at),
    );
  const total = outstanding.reduce((acc, c) => acc + c.amount_pence, 0);
  return (
    <div className="mx-auto w-full max-w-2xl pb-6">
      <header className="px-4 pt-6 pb-4">
        <p className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
          You owe
        </p>
        <p className="text-navy mt-1 text-4xl font-bold tracking-[-0.02em] dark:text-white">
          {fmtMoneyPence(total)}
        </p>
        <p className="text-text-secondary mt-1 text-sm">
          {outstanding.length === 0
            ? "Nothing outstanding. Cheers."
            : `${outstanding.length} unpaid match donation${outstanding.length === 1 ? "" : "s"}`}
        </p>
        {outstanding.length > 0 && (
          <Button asChild tone="primary" className="mt-3 w-full">
            <a
              href={mainSiteUrl("/members?tab=payments")}
              target="_blank"
              rel="noopener"
            >
              Pay on main site ↗
            </a>
          </Button>
        )}
        <p className="text-text-muted mt-2 text-xs">
          Payments are handled by Stripe on the main Percy Main site.
        </p>
      </header>

      <div className="bg-surface-raised mx-4 grid grid-cols-2 gap-1 rounded-xl p-1">
        <TabBtn
          active={tab === "outstanding"}
          onClick={() => setTab("outstanding")}
        >
          Outstanding ({outstanding.length})
        </TabBtn>
        <TabBtn active={tab === "history"} onClick={() => setTab("history")}>
          History ({history.length})
        </TabBtn>
      </div>

      <div className="mt-1">
        {isLoading && <ChargeSkeleton />}
        {isError && (
          <p className="text-text-secondary px-4 py-6 text-sm">
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

function ChargeRowItem({ c, muted }: { c: Charge; muted?: boolean }) {
  const overdue = isOpen(c) && isOverdue(c);
  const status = c.paid_at
    ? { tone: "success" as const, label: `Paid ${fmtDate(c.paid_at)}` }
    : c.deleted_at
      ? { tone: "neutral" as const, label: "Voided" }
      : c.relieved_at
        ? { tone: "warning" as const, label: "Relieved" }
        : null;
  return (
    <div
      className={cn(
        "border-border-light grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t px-4 py-3",
        muted && "opacity-70",
      )}
    >
      {c.charge_date ? (
        <div className="bg-surface-raised flex flex-col items-center justify-center rounded-md py-1">
          <div className="text-navy text-base leading-none font-bold dark:text-white">
            {new Date(c.charge_date).getDate()}
          </div>
          <div className="text-text-secondary text-[10px] tracking-wide uppercase">
            {fmtDate(c.charge_date, "MMM")}
          </div>
        </div>
      ) : (
        <span className="size-11" />
      )}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{c.description}</div>
        <div className="text-text-secondary mt-0.5 text-xs">
          {[c.type, c.charge_date ? fmtDate(c.charge_date) : null]
            .filter(Boolean)
            .join(" · ")}
          {overdue && (
            <span className="text-danger ml-2 font-medium">
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
          {fmtMoneyPence(c.amount_pence)}
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
          <div className="bg-border size-11 rounded-md" />
          <div className="flex-1 space-y-2">
            <div className="bg-border h-4 w-2/3 rounded-md" />
            <div className="bg-border-light h-3 w-1/2 rounded-md" />
          </div>
          <div className="bg-border h-5 w-12 rounded-md" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-text-secondary mt-1 text-sm">{body}</p>
    </div>
  );
}

function isOverdue(c: Charge): boolean {
  if (!c.created_at) return false;
  return (Date.now() - new Date(c.created_at).getTime()) / 86_400_000 > 14;
}
