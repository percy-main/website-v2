import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import { MembershipCard } from "@/features/donations/membership-card.js";
import { PayOutstandingDialog } from "@/features/donations/pay-outstanding-dialog.js";
import { fmtDate, fmtMoneyPence } from "@/features/format.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { cn } from "@/lib/utils.js";
import { useQuery } from "@tanstack/react-query";
import { parseISO } from "date-fns";
import { CheckIcon, ReceiptIcon } from "lucide-react";
import { useMemo, useState } from "react";

type Tab = "outstanding" | "history";

type ChargesResponse = ApiResponse<"/api/charges">;
type Charge = ChargesResponse["charges"][number];

function isOpen(c: Charge): boolean {
  // `payment_confirmed_at` is set by POST /charges/confirm-payment the moment
  // Stripe accepts the payment, before the webhook flips `paid_at`. Treating
  // it as "not open" keeps the row out of Outstanding (and the optimistic
  // cache update) so the user doesn't see a stale unpaid state mid-settlement.
  return (
    !c.paid_at && !c.deleted_at && !c.relieved_at && !c.payment_confirmed_at
  );
}

/**
 * Donations view. Members can:
 *  - See their current membership category + expiry at a glance
 *  - Tick which outstanding donations to settle and pay inline (Stripe
 *    PaymentElement — Apple Pay / Google Pay surface automatically on
 *    mobile via `automatic_payment_methods`)
 *  - Browse their payment history
 */
export default function Donations() {
  const [tab, setTab] = useState<Tab>("outstanding");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["charges"],
    queryFn: () => callApi(api.GET("/api/charges")),
  });
  const charges = useMemo(() => data?.charges ?? [], [data]);
  const outstanding = useMemo(() => charges.filter(isOpen), [charges]);
  const history = useMemo(
    () =>
      charges
        .filter((c) => !isOpen(c))
        .sort((a, b) =>
          (b.paid_at ?? b.created_at).localeCompare(a.paid_at ?? a.created_at),
        ),
    [charges],
  );

  // Track *deselected* rows, not selected ones. Outstanding is "everything by
  // default"; encoding the exception set means we don't need a useEffect to
  // sync the selection whenever the outstanding list changes (e.g. after a
  // payment lands and the query refetches).
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const isSelected = (id: string) => !deselected.has(id);

  const selectedIds = useMemo(
    () => outstanding.filter((c) => isSelected(c.id)).map((c) => c.id),
    // isSelected is a closure over deselected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outstanding, deselected],
  );
  const selectedTotal = outstanding
    .filter((c) => isSelected(c.id))
    .reduce((acc, c) => acc + c.amount_pence, 0);

  const [paying, setPaying] = useState<{ ids: string[] } | null>(null);

  function toggle(id: string) {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="mx-auto w-full max-w-2xl pb-6">
      <header className="px-4 pt-6 pb-4">
        <p className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
          You owe
        </p>
        <p className="text-navy mt-1 text-4xl font-bold tracking-[-0.02em] dark:text-white">
          {fmtMoneyPence(
            outstanding.reduce((acc, c) => acc + c.amount_pence, 0),
          )}
        </p>
        {outstanding.length > 0 && (
          <p className="text-text-secondary mt-1 text-sm">
            {outstanding.length} unpaid match donation
            {outstanding.length === 1 ? "" : "s"}
          </p>
        )}
      </header>

      <MembershipCard />

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
                tone="success"
                icon={<CheckIcon className="size-7" strokeWidth={2.4} />}
                title="All paid up"
                body="No outstanding donations. Thanks for keeping your match donations square."
              />
            ) : (
              outstanding.map((c) => (
                <ChargeRowItem
                  key={c.id}
                  c={c}
                  selected={isSelected(c.id)}
                  onToggle={() => {
                    toggle(c.id);
                  }}
                />
              ))
            )}
          </>
        )}
        {!isLoading && !isError && tab === "history" && (
          <>
            {history.length === 0 ? (
              <EmptyState
                tone="neutral"
                icon={<ReceiptIcon className="size-7" strokeWidth={1.8} />}
                title="No history yet"
                body="Your paid donations will show here once you've made one."
              />
            ) : (
              history.map((c) => <ChargeRowItem key={c.id} c={c} muted />)
            )}
          </>
        )}
      </div>

      {tab === "outstanding" && outstanding.length > 0 && (
        <PayBar
          amountPence={selectedTotal}
          count={selectedIds.length}
          onPay={() => {
            setPaying({ ids: selectedIds });
          }}
        />
      )}

      <PayOutstandingDialog
        open={!!paying}
        onOpenChange={(open) => {
          if (!open) setPaying(null);
        }}
        chargeIds={paying?.ids ?? []}
      />
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

function ChargeRowItem({
  c,
  muted,
  selected,
  onToggle,
}: {
  c: Charge;
  muted?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const overdue = isOpen(c) && isOverdue(c);
  const status = c.paid_at
    ? { tone: "success" as const, label: `Paid ${fmtDate(c.paid_at)}` }
    : c.deleted_at
      ? { tone: "neutral" as const, label: "Voided" }
      : c.relieved_at
        ? { tone: "warning" as const, label: "Relieved" }
        : c.payment_confirmed_at
          ? { tone: "navy" as const, label: "Processing…" }
          : null;

  const selectable = onToggle !== undefined;
  // Whole row is the tap target on a phone — bigger than a 16px checkbox.
  const RowEl: "button" | "div" = selectable ? "button" : "div";

  return (
    <RowEl
      type={selectable ? "button" : undefined}
      onClick={selectable ? onToggle : undefined}
      aria-pressed={selectable ? selected : undefined}
      className={cn(
        "border-border-light grid w-full items-center gap-3 border-t px-4 py-3 text-left",
        selectable
          ? "focus:bg-surface-raised/60 grid-cols-[24px_44px_1fr_auto] focus:outline-none"
          : "grid-cols-[44px_1fr_auto]",
        muted && "opacity-70",
      )}
    >
      {selectable && (
        <span
          aria-hidden
          className={cn(
            "grid size-5 place-items-center rounded-md border transition-colors",
            selected
              ? "bg-navy border-navy dark:text-navy text-white dark:border-white dark:bg-white"
              : "border-border bg-surface",
          )}
        >
          {selected && <CheckIcon className="size-3.5" strokeWidth={3} />}
        </span>
      )}
      {c.charge_date ? (
        <div className="bg-surface-raised flex flex-col items-center justify-center rounded-md py-1">
          <div className="text-navy text-base leading-none font-bold dark:text-white">
            {parseISO(c.charge_date).getDate()}
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
    </RowEl>
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

function EmptyState({
  tone,
  icon,
  title,
  body,
}: {
  tone: "success" | "neutral";
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-12 text-center">
      <div
        className={cn(
          "grid size-14 place-items-center rounded-full",
          tone === "success"
            ? "bg-success-bg text-success"
            : "bg-border text-text-secondary",
        )}
      >
        {icon}
      </div>
      <p className="mt-4 text-base font-semibold tracking-[-0.01em]">{title}</p>
      <p className="text-text-secondary mt-1 text-sm leading-relaxed">{body}</p>
    </div>
  );
}

function PayBar({
  amountPence,
  count,
  onPay,
}: {
  amountPence: number;
  count: number;
  onPay: () => void;
}) {
  const disabled = count === 0 || amountPence <= 0;
  return (
    // `sticky` inside the donations max-w-2xl column auto-aligns the bar with
    // the list. `bottom-16` clears the mobile bottom tab bar; on desktop the
    // tab bar is hidden and the AppShell adds a w-56 side nav, so we float a
    // few pixels above the viewport edge instead.
    <div className="sticky bottom-16 z-40 mt-4 px-4 md:bottom-4">
      <div className="bg-surface border-border-light supports-[backdrop-filter]:bg-surface/95 rounded-xl border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg backdrop-blur">
        <Button
          tone="primary"
          size="lg"
          className="w-full"
          disabled={disabled}
          onClick={onPay}
        >
          {disabled
            ? "Select donations to pay"
            : `Pay ${fmtMoneyPence(amountPence)}`}
          {!disabled && count > 1 && (
            <span className="ml-1 text-xs font-medium opacity-80">
              ({count} donations)
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}

function isOverdue(c: Charge): boolean {
  if (!c.created_at) return false;
  return (Date.now() - new Date(c.created_at).getTime()) / 86_400_000 > 14;
}
