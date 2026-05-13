import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import { CrownIcon, GloveIcon } from "@/features/icons/cricket-icons.js";
import { fmtDate, fmtMoneyPence } from "@/features/format.js";
import { resizeImageForUpload } from "@/features/image-resize.js";
import { api, callApi } from "@/lib/api-client.js";
import { cn } from "@/lib/utils.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

/**
 * Phase 3 captain match day — the single most important phone screen.
 *
 * Squad with paid toggles + payment method, FAB add-expense bottom sheet,
 * finish-match bottom sheet with result picker. Optimistic mark-paid so
 * patchy 4G doesn't slow the captain down.
 */

interface MatchdayPlayer {
  id: string;
  member_id: string | null;
  player_name: string;
  status: string;
  is_captain: boolean;
  is_wicketkeeper: boolean;
  charge_id: string | null;
  member_category: string | null;
  chargePaidAt: string | null;
  chargeStatus: "paid" | "waived" | "unpaid" | null;
}

interface MatchdayExpense {
  id: string;
  expense_type: string;
  description: string | null;
  amount_pence: number;
  status: string;
}

interface MatchdayDetail {
  matchday: {
    id: string;
    match_date: string;
    opposition: string;
    competition_type: string | null;
    status: string;
    result_type: string | null;
  };
  team: { id: string; name: string | null } | null;
  players: MatchdayPlayer[];
  expenses: MatchdayExpense[];
}

type PaymentMethod = "cash" | "bank_transfer" | "card";
type Result = "W" | "L" | "D" | "T" | "A" | "C" | "N";

export default function MatchdayLive() {
  const { matchdayId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [methodOverrides, setMethodOverrides] = useState<
    Record<string, PaymentMethod>
  >({});

  const { data } = useQuery({
    queryKey: ["matchday", matchdayId],
    queryFn: () =>
      callApi(
        api.GET("/api/matchday/{matchId}", {
          params: { path: { matchId: matchdayId ?? "" } },
        }),
      ),
    enabled: !!matchdayId,
  });
  const md = data as unknown as MatchdayDetail | undefined;

  const markPaid = useMutation({
    mutationFn: (vars: { playerId: string; paymentMethod: PaymentMethod }) =>
      callApi(
        api.POST(
          "/api/matchday/{matchId}/players/{playerId}/mark-paid",
          {
            params: {
              path: {
                matchId: matchdayId ?? "",
                playerId: vars.playerId,
              },
            },
            body: { paymentMethod: vars.paymentMethod },
          },
        ),
      ),
    onMutate: async (vars) => {
      // Optimistic — flip the row's chargeStatus to "paid" immediately so
      // the captain sees the green tick even with patchy signal. Rollback
      // on failure via onError.
      await qc.cancelQueries({ queryKey: ["matchday", matchdayId] });
      const prev = qc.getQueryData(["matchday", matchdayId]);
      qc.setQueryData(["matchday", matchdayId], (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        const o = old as MatchdayDetail;
        return {
          ...o,
          players: o.players.map((p) =>
            p.id === vars.playerId
              ? { ...p, chargeStatus: "paid", chargePaidAt: new Date().toISOString() }
              : p,
          ),
        };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["matchday", matchdayId], ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["matchday", matchdayId] });
    },
  });

  if (!md) {
    return (
      <div className="space-y-2 p-4">
        <div className="h-16 rounded-md bg-border" />
        <div className="h-32 rounded-2xl bg-border" />
      </div>
    );
  }

  const playing = md.players.filter(
    (p) => p.status === "playing" || p.status === "selected",
  );
  const dropouts = md.players.filter(
    (p) =>
      p.status === "dropped_out" ||
      p.status === "no_show" ||
      p.status === "withdrawn",
  );
  // "Settled" means the captain doesn't need to chase the player — either
  // they've paid or the treasurer's already waived the donation via the
  // financial-relief workflow (charge.relieved_at, projected as
  // chargeStatus === "waived"). Either way, the row shows green and is
  // unactionable.
  const isSettled = (status: string | null) =>
    status === "paid" || status === "waived";
  const paid = playing.filter((p) => isSettled(p.chargeStatus)).length;
  const unpaid = playing.filter(
    (p) => p.chargeStatus === "unpaid" || p.chargeStatus === null,
  ).length;
  const totalUnpaidPence = 0; // amount per charge isn't on the player projection — would need a join. Skip totals for now.
  const finished = md.matchday.status === "finished";

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="bg-navy px-4 py-3 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] opacity-70">
          Match day · captain
        </p>
        <h1 className="mt-0.5 text-lg font-semibold tracking-[-0.01em]">
          {md.team?.name ?? "Team"} vs {md.matchday.opposition}
        </h1>
        <p className="mt-0.5 text-[12px] opacity-75">
          {fmtDate(md.matchday.match_date, "EEE d MMM")}
          {md.matchday.competition_type
            ? ` · ${md.matchday.competition_type}`
            : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <StatusPill
            tone="navy"
            className="bg-white/10 text-white dark:text-white"
          >
            {playing.length} playing
          </StatusPill>
          <StatusPill
            tone="success"
            className="bg-white/10 text-white dark:text-white"
          >
            {paid} paid
          </StatusPill>
          {unpaid > 0 && (
            <StatusPill
              tone="warning"
              className="bg-warning/30 text-white dark:text-white"
            >
              {unpaid} unpaid
            </StatusPill>
          )}
        </div>
      </header>

      <div className="flex-1 pb-44">
        <h2 className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
          Squad · {playing.length}
        </h2>
        {playing.map((p) => {
          const isPaid = isSettled(p.chargeStatus);
          const method = methodOverrides[p.id] ?? "cash";
          return (
            <div
              key={p.id}
              className={cn(
                "flex items-center gap-3 border-t border-border-light px-4 py-3",
                isPaid ? "bg-success-bg" : "bg-surface",
              )}
            >
              <button
                type="button"
                disabled={isPaid || finished}
                onClick={() =>
                  markPaid.mutate({ playerId: p.id, paymentMethod: method })
                }
                aria-label={`Mark ${p.player_name} paid`}
                className={cn(
                  "grid size-9 place-items-center rounded-full border-2",
                  isPaid
                    ? "border-success bg-success text-white"
                    : "border-border bg-surface text-transparent",
                )}
              >
                <CheckIcon className="size-4" strokeWidth={3} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[15px] font-semibold">
                  {p.is_captain && (
                    <CrownIcon className="size-3.5 text-warning" />
                  )}
                  {p.is_wicketkeeper && (
                    <GloveIcon className="size-3.5 text-info" />
                  )}
                  <span className="truncate">{p.player_name}</span>
                </p>
                <p className="mt-0.5 text-[12px] text-text-secondary">
                  {isPaid
                    ? p.chargePaidAt
                      ? `Paid · ${new Date(p.chargePaidAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                      : "Paid"
                    : `${p.member_category ?? "Adult"} · donation due`}
                </p>
              </div>
              {!isPaid && !finished && (
                <select
                  aria-label="Payment method"
                  value={method}
                  onChange={(e) => {
                    // Read the value synchronously inside the handler.
                    // React 17+ nulls e.currentTarget after the handler
                    // returns, and the functional setState updater runs
                    // in a later tick — so capturing `e` and reading
                    // currentTarget inside it would crash.
                    const next = e.currentTarget.value as PaymentMethod;
                    setMethodOverrides((prev) => ({
                      ...prev,
                      [p.id]: next,
                    }));
                  }}
                  className="rounded-md bg-surface-raised px-2 py-1 text-[11px] font-semibold text-text-secondary"
                >
                  <option value="cash">cash</option>
                  <option value="bank_transfer">bank</option>
                  <option value="card">card</option>
                </select>
              )}
            </div>
          );
        })}

        {dropouts.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer bg-surface-raised px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
              Drop-outs · {dropouts.length}
            </summary>
            <ul className="divide-y divide-border-light">
              {dropouts.map((p) => (
                <li
                  key={p.id}
                  className="bg-surface px-4 py-2.5 text-sm text-text-secondary"
                >
                  {p.player_name}
                </li>
              ))}
            </ul>
          </details>
        )}

        {md.expenses.length > 0 && (
          <section className="mt-3">
            <h2 className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
              Expenses · {md.expenses.length}
            </h2>
            <ul className="divide-y divide-border-light">
              {md.expenses.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between bg-surface px-4 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {labelExpense(e.expense_type)}
                    </p>
                    {e.description && (
                      <p className="text-[11px] text-text-secondary">
                        {e.description}
                      </p>
                    )}
                  </div>
                  <p className="text-sm font-semibold">
                    {fmtMoneyPence(e.amount_pence)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {!finished && (
        <button
          type="button"
          onClick={() => setExpenseOpen(true)}
          aria-label="Add expense"
          className="fixed right-4 bottom-28 z-30 grid size-14 place-items-center rounded-full bg-navy text-white shadow-lg"
        >
          <PlusIcon className="size-6" />
        </button>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:static">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
          {!finished ? (
            <Button
              tone="destructive"
              size="lg"
              className="flex-1"
              onClick={() => setFinishOpen(true)}
            >
              Finish match
            </Button>
          ) : (
            <p className="flex-1 text-center text-sm text-text-secondary">
              Match finished · result {md.matchday.result_type ?? "—"}
            </p>
          )}
        </div>
      </div>

      {expenseOpen && (
        <AddExpenseSheet
          matchdayId={matchdayId ?? ""}
          onClose={() => setExpenseOpen(false)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ["matchday", matchdayId] });
            setExpenseOpen(false);
          }}
        />
      )}
      {finishOpen && (
        <FinishSheet
          matchdayId={matchdayId ?? ""}
          unpaidCount={unpaid}
          draftExpenseCount={
            md.expenses.filter((e) => e.status === "draft").length
          }
          totalUnpaidPence={totalUnpaidPence}
          onClose={() => setFinishOpen(false)}
          onFinished={() => {
            void qc.invalidateQueries({ queryKey: ["matchday", matchdayId] });
            setFinishOpen(false);
            void navigate(`/matchday/${matchdayId ?? ""}/live`);
          }}
          onCancel={() => {
            setFinishOpen(false);
            void navigate("/squad");
          }}
        />
      )}
    </div>
  );
}

function labelExpense(t: string): string {
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

type ExpenseType =
  | "umpire_fee"
  | "scorer_fee"
  | "match_ball"
  | "teas"
  | "miscellaneous";

function AddExpenseSheet({
  matchdayId,
  onClose,
  onSaved,
}: {
  matchdayId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<ExpenseType>("match_ball");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/matchday/{matchId}/expenses", {
          params: { path: { matchId: matchdayId } },
          body: {
            type,
            amountPence: Math.round(parseFloat(amount || "0") * 100),
            ...(description && { description }),
            ...(receipt && { receiptImage: receipt }),
          },
        }),
      ),
    onSuccess: onSaved,
  });

  async function onPhoto(file: File) {
    const data = await resizeImageForUpload(file);
    setReceipt(data);
  }

  return (
    <Sheet onClose={onClose} title="Add an expense">
      <Eyebrow>Type</Eyebrow>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {(
          [
            ["match_ball", "Ball"],
            ["umpire_fee", "Umpire"],
            ["scorer_fee", "Scorer"],
            ["teas", "Teas"],
            ["miscellaneous", "Misc"],
          ] as Array<[ExpenseType, string]>
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setType(k)}
            className={cn(
              "rounded-full border px-3 py-2 text-xs font-semibold",
              type === k
                ? "border-navy bg-navy text-white"
                : "border-border bg-surface text-text-secondary",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Eyebrow className="mt-4">Amount</Eyebrow>
      <div className="mt-1 flex items-baseline gap-1 rounded-xl bg-surface-raised px-4 py-3 text-3xl">
        <span className="text-text-secondary">£</span>
        <input
          inputMode="decimal"
          pattern="[0-9]*"
          value={amount}
          onChange={(e) => setAmount(e.currentTarget.value)}
          placeholder="0.00"
          className="w-full bg-transparent text-3xl font-semibold tracking-[-0.02em] outline-none placeholder:text-text-muted"
        />
      </div>

      <Eyebrow className="mt-4">Description</Eyebrow>
      <input
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
        placeholder="optional"
        className="mt-1 h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm"
      />

      <Eyebrow className="mt-4">Receipt</Eyebrow>
      <label className="mt-1 flex h-20 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-border bg-surface-raised text-sm text-text-secondary">
        {receipt ? "Receipt attached · tap to replace" : "Tap to take a photo"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) void onPhoto(f);
          }}
          className="sr-only"
        />
      </label>

      {save.isError && (
        <p className="mt-2 text-sm text-danger">
          Couldn't save expense, try again.
        </p>
      )}

      <Button
        tone="primary"
        size="lg"
        className="mt-4 w-full"
        disabled={!amount || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? "Saving…" : "Save expense"}
      </Button>
      <p className="mt-2 text-center text-[11px] text-text-secondary">
        Submitted to the treasurer when you finish the match.
      </p>
    </Sheet>
  );
}

function FinishSheet({
  matchdayId,
  unpaidCount,
  draftExpenseCount,
  totalUnpaidPence,
  onClose,
  onFinished,
  onCancel,
}: {
  matchdayId: string;
  unpaidCount: number;
  draftExpenseCount: number;
  totalUnpaidPence: number;
  onClose: () => void;
  onFinished: () => void;
  onCancel: () => void;
}) {
  const [result, setResult] = useState<Result>("W");

  const finish = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/matchday/{matchId}/finish", {
          params: { path: { matchId: matchdayId } },
          body: { resultType: result },
        }),
      ),
    onSuccess: onFinished,
  });

  const cancel = useMutation({
    mutationFn: (reason: string) =>
      callApi(
        api.POST("/api/matchday/{matchId}/cancel", {
          params: { path: { matchId: matchdayId } },
          body: { reason },
        }),
      ),
    onSuccess: onCancel,
  });

  return (
    <Sheet onClose={onClose} title="Finish match">
      <Eyebrow>Result</Eyebrow>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {(["W", "L", "D", "T", "A", "C", "N"] as Result[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setResult(r)}
            className={cn(
              "rounded-md border py-2.5 text-sm font-bold",
              result === r
                ? "border-navy bg-navy text-white"
                : "border-border bg-surface text-text-secondary",
            )}
          >
            {r}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-text-secondary">
        W win · L lose · D draw · T tied · A abandoned · C conceded · N
        no-result
      </p>

      <div className="mt-4 space-y-1 rounded-xl bg-surface-raised p-3 text-sm">
        <Row label={`${unpaidCount} unpaid`}>will be charged</Row>
        <Row label={`${draftExpenseCount} draft expenses`}>will be submitted</Row>
        <Row label="Donation emails">will be sent</Row>
        {totalUnpaidPence > 0 && (
          <Row label="Approx total">{fmtMoneyPence(totalUnpaidPence)}</Row>
        )}
      </div>

      <Button
        tone="primary"
        size="lg"
        className="mt-4 w-full"
        disabled={finish.isPending}
        onClick={() => finish.mutate()}
      >
        {finish.isPending ? "Finishing…" : "Confirm · finish match"}
      </Button>
      <div className="mt-2 flex gap-2">
        <Button tone="outline" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button
          tone="ghost"
          className="flex-1 text-danger"
          disabled={cancel.isPending}
          onClick={() => {
            const reason = prompt(
              "Cancel match — what's the reason? (rained off, ground unfit, opposition pulled out, etc.)",
            );
            if (reason?.trim()) cancel.mutate(reason.trim());
          }}
        >
          Cancel match (no charges)
        </Button>
      </div>
      {finish.isError && (
        <p className="mt-2 text-sm text-danger">Couldn't finish, try again.</p>
      )}
    </Sheet>
  );
}

function Sheet({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 md:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-surface p-5 pb-[max(env(safe-area-inset-bottom),24px)] shadow-2xl md:rounded-3xl">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-border" />
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-md text-text-secondary"
          >
            <XIcon className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary",
        className,
      )}
    >
      {children}
    </p>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-text-secondary">{label}</span>
      <strong className="text-text">{children}</strong>
    </div>
  );
}
