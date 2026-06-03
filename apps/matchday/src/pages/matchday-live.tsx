import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import { fmtDate, fmtMoneyPence } from "@/features/format.js";
import { CrownIcon, GloveIcon } from "@/features/icons/cricket-icons.js";
import { resizeImageForUpload } from "@/features/image-resize.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { cn } from "@/lib/utils.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, XIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";

/**
 * Post-match wrap (amendments §5). One screen carries the captain
 * through:
 *   1. Confirm who actually played - per-player playing / dropped-out
 *      / no-show selector.
 *   2. Result picker.
 *   3. Confirm - this is what creates the match-fee charges. No emails
 *      go out yet. If the API reports any player without a resolved
 *      fee, the captain enters the amount inline and re-submits.
 *   4. Mark each charge paid + payment method (post-finish only) - the
 *      captain ticks off anyone who paid cash / bank transfer on the day.
 *   5. Send donation requests - emails/pushes only the players still
 *      unpaid. One-shot: once sent it can't be re-sent, so later cash is
 *      just recorded via the mark-paid tick without re-nagging anyone.
 *
 * Pre-finish there are no charges yet, so the mark-paid UI is hidden.
 */

type MatchdayDetail = ApiResponse<"/api/matchday/{matchId}">;
type MatchdayPlayer = MatchdayDetail["players"][number];
type PlayerStatus = "playing" | "dropped_out" | "no_show";

type PaymentMethod = "cash" | "bank_transfer" | "card";
type Result = "W" | "L" | "D" | "T" | "A" | "C" | "N";

export default function MatchdayLive() {
  const { matchdayId } = useParams();
  const qc = useQueryClient();
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [methodOverrides, setMethodOverrides] = useState<
    Record<string, PaymentMethod>
  >({});
  // Pre-finish wrap state - captain's per-player playing/dropped/no-show
  // call. Defaults to whatever's already in the DB (selected → playing,
  // existing playing/dropped/no-show kept) so a captain can submit
  // without touching every row.
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, PlayerStatus>
  >({});
  // Two-step confirm on the one-shot donation-request batch - sending
  // emails/pushes to members is outward-facing and can't be undone.
  const [confirmNotify, setConfirmNotify] = useState(false);

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
  const md: MatchdayDetail | undefined = data;

  const markPaid = useMutation({
    mutationFn: (vars: { playerId: string; paymentMethod: PaymentMethod }) =>
      callApi(
        api.POST("/api/matchday/{matchId}/players/{playerId}/mark-paid", {
          params: {
            path: {
              matchId: matchdayId ?? "",
              playerId: vars.playerId,
            },
          },
          body: { paymentMethod: vars.paymentMethod },
        }),
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
              ? {
                  ...p,
                  chargeStatus: "paid",
                  chargePaidAt: new Date().toISOString(),
                }
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

  const notify = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/matchday/{matchId}/notify-charges", {
          params: { path: { matchId: matchdayId ?? "" } },
        }),
      ),
    onSuccess: () => {
      setConfirmNotify(false);
      void qc.invalidateQueries({ queryKey: ["matchday", matchdayId] });
    },
  });

  if (!md) {
    return (
      <div className="space-y-2 p-4">
        <div className="bg-border h-16 rounded-md" />
        <div className="bg-border h-32 rounded-2xl" />
      </div>
    );
  }

  const resolveStatus = (p: MatchdayPlayer): PlayerStatus => {
    const override = statusOverrides[p.id];
    if (override) return override;
    if (
      p.status === "dropped_out" ||
      p.status === "no_show" ||
      p.status === "withdrawn"
    ) {
      return p.status === "withdrawn" ? "dropped_out" : p.status;
    }
    return "playing";
  };

  // Juniors live in the `dependent` table - they have no member row of
  // their own, so member_category comes back null and the row would
  // otherwise label as the generic "Adult" fallback. Match the
  // server-side fee derivation in finishMatch (see service.ts:1382).
  const resolveCategory = (p: MatchdayPlayer): string => {
    if (p.dependent_id) return "junior";
    return p.member_category ?? "adult";
  };

  const finished = md.matchday.status === "finished";
  const playing = md.players.filter((p) => resolveStatus(p) === "playing");
  const dropouts = md.players.filter((p) => resolveStatus(p) !== "playing");
  // "Settled" means the captain doesn't need to chase the player - either
  // they've paid or the treasurer's already waived the donation via the
  // financial-relief workflow (charge.relieved_at, projected as
  // chargeStatus === "waived"). Either way, the row shows green and is
  // unactionable. chargeStatus === null means there's no charge to
  // settle at all (fee-free teams like women's softball, or a player
  // whose category resolves to 0 pence), so they shouldn't count as
  // unpaid and shouldn't get a mark-paid affordance.
  const isSettled = (status: string | null) =>
    status === "paid" || status === "waived";
  const hasCharge = (p: MatchdayPlayer) => p.chargeStatus !== null;
  const paid = playing.filter((p) => isSettled(p.chargeStatus)).length;
  const unpaid = playing.filter((p) => p.chargeStatus === "unpaid").length;
  // Donation requests are a one-shot batch sent after wrap-up. Null until
  // the captain fires it; once set, late cash is just recorded via the
  // mark-paid tick and nobody is re-nagged.
  const notified = md.matchday.charges_notified_at != null;

  return (
    <div className="bg-surface flex min-h-full flex-col">
      <header className="bg-navy px-4 py-3 text-white">
        <p className="text-[11px] font-semibold tracking-[0.06em] uppercase opacity-70">
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

      <div>
        <h2 className="text-text-secondary px-4 pt-3 pb-1 text-[11px] font-semibold tracking-[0.06em] uppercase">
          Squad · {md.players.length}
        </h2>
        {finished && !notified && unpaid > 0 && (
          <p className="text-text-secondary px-4 pb-1 text-[12px]">
            Tick off anyone who paid on the day, then send donation requests to
            the rest.
          </p>
        )}
        {md.players.map((p) => {
          const status = resolveStatus(p);
          const isPaid = isSettled(p.chargeStatus);
          const method = methodOverrides[p.id] ?? "cash";
          const rowTone =
            finished && status === "playing" && isPaid
              ? "bg-success-bg"
              : status !== "playing"
                ? "bg-surface-raised"
                : "bg-surface";
          return (
            <div
              key={p.id}
              className={cn(
                "border-border-light flex flex-wrap items-center gap-3 border-t px-4 py-3",
                rowTone,
              )}
            >
              {finished ? (
                <button
                  type="button"
                  disabled={isPaid || status !== "playing" || !hasCharge(p)}
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
              ) : (
                <StatusToggle
                  value={status}
                  onChange={(next) =>
                    setStatusOverrides((prev) => ({ ...prev, [p.id]: next }))
                  }
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[15px] font-semibold">
                  {p.is_captain && (
                    <CrownIcon className="text-warning size-3.5" />
                  )}
                  {p.is_wicketkeeper && (
                    <GloveIcon className="text-info size-3.5" />
                  )}
                  <span className="truncate">{p.player_name}</span>
                </p>
                <p className="text-text-secondary mt-0.5 text-[12px]">
                  {finished
                    ? status !== "playing"
                      ? labelStatus(status)
                      : isPaid
                        ? p.chargePaidAt
                          ? `Paid · ${new Date(p.chargePaidAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                          : "Paid"
                        : hasCharge(p)
                          ? `${resolveCategory(p)} · donation due`
                          : resolveCategory(p)
                    : resolveCategory(p)}
                </p>
              </div>
              {finished && status === "playing" && !isPaid && hasCharge(p) && (
                <select
                  aria-label="Payment method"
                  value={method}
                  onChange={(e) => {
                    const next = e.currentTarget.value as PaymentMethod;
                    setMethodOverrides((prev) => ({
                      ...prev,
                      [p.id]: next,
                    }));
                  }}
                  className="bg-surface-raised text-text-secondary rounded-md px-2 py-1 text-[11px] font-semibold"
                >
                  <option value="cash">cash</option>
                  <option value="bank_transfer">bank</option>
                  <option value="card">card</option>
                </select>
              )}
            </div>
          );
        })}

        {!finished && dropouts.length > 0 && (
          <p className="text-text-secondary px-4 pt-3 text-[12px]">
            {dropouts.length} marked as not playing.
          </p>
        )}

        {md.expenses.length > 0 && (
          <section className="mt-3">
            <h2 className="text-text-secondary px-4 pt-2 pb-1 text-[11px] font-semibold tracking-[0.06em] uppercase">
              Expenses · {md.expenses.length}
            </h2>
            <ul className="divide-border-light divide-y">
              {md.expenses.map((e) => (
                <li
                  key={e.id}
                  className="bg-surface flex items-center justify-between px-4 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {labelExpense(e.expense_type)}
                    </p>
                    {e.description && (
                      <p className="text-text-secondary text-[11px]">
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

      <div className="border-border bg-surface mt-4 border-t">
        <div className="mx-auto flex max-w-2xl flex-col gap-2 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] md:flex-row md:items-center">
          {!isPastExpenseCutoff(md.matchday.match_date) &&
            md.matchday.status !== "cancelled" && (
              <Button
                tone="outline"
                size="lg"
                className="w-full md:flex-1"
                onClick={() => setExpenseOpen(true)}
              >
                Add expense
              </Button>
            )}
          {!finished ? (
            <Button
              tone="destructive"
              size="lg"
              className="w-full md:flex-1"
              onClick={() => setFinishOpen(true)}
            >
              Finish match
            </Button>
          ) : notified ? (
            <div className="w-full md:flex-1">
              <p className="text-text-secondary text-center text-sm">
                Donation requests sent · result {md.matchday.result_type ?? "—"}
              </p>
              {notify.data && notify.data.emailErrors.length > 0 && (
                <p className="text-danger mt-1 text-center text-[12px]">
                  {notify.data.emailErrors.length} could not be delivered -
                  chase via the charges admin.
                </p>
              )}
            </div>
          ) : unpaid === 0 ? (
            <p className="text-text-secondary w-full text-center text-sm md:flex-1">
              All donations settled · result {md.matchday.result_type ?? "—"}
            </p>
          ) : confirmNotify ? (
            <div className="w-full md:flex-1">
              <p className="text-text-secondary mb-2 text-center text-[13px]">
                Email/push {unpaid} unpaid {unpaid === 1 ? "player" : "players"}
                ? This can only be sent once.
              </p>
              <div className="flex gap-2">
                <Button
                  tone="outline"
                  size="lg"
                  className="flex-1"
                  disabled={notify.isPending}
                  onClick={() => setConfirmNotify(false)}
                >
                  Cancel
                </Button>
                <Button
                  tone="primary"
                  size="lg"
                  className="flex-1"
                  disabled={notify.isPending}
                  onClick={() => notify.mutate()}
                >
                  {notify.isPending ? "Sending…" : "Send now"}
                </Button>
              </div>
              {notify.isError && (
                <p className="text-danger mt-2 text-center text-[12px]">
                  {notify.error instanceof Error
                    ? notify.error.message
                    : "Could not send donation requests."}
                </p>
              )}
            </div>
          ) : (
            <Button
              tone="primary"
              size="lg"
              className="w-full md:flex-1"
              onClick={() => setConfirmNotify(true)}
            >
              Send donation requests · {unpaid}
            </Button>
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
          players={md.players}
          resolveStatus={resolveStatus}
          draftExpenseCount={
            md.expenses.filter((e) => e.status === "draft").length
          }
          onClose={() => setFinishOpen(false)}
          onFinished={() => {
            void qc.invalidateQueries({ queryKey: ["matchday", matchdayId] });
            setFinishOpen(false);
          }}
        />
      )}
    </div>
  );
}

// Expense window mirrors the API gate from amendments §4: open from
// matchday creation through match_date + 5 days, hard-closed after.
function isPastExpenseCutoff(matchDate: string, now = new Date()): boolean {
  const match = new Date(`${matchDate}T00:00:00Z`);
  if (Number.isNaN(match.getTime())) return false;
  const cutoff = new Date(match);
  cutoff.setUTCDate(cutoff.getUTCDate() + 6);
  return now >= cutoff;
}

function labelStatus(s: PlayerStatus): string {
  if (s === "dropped_out") return "Dropped out";
  if (s === "no_show") return "No-show";
  return "Playing";
}

function StatusToggle({
  value,
  onChange,
}: {
  value: PlayerStatus;
  onChange: (next: PlayerStatus) => void;
}) {
  return (
    <select
      aria-label="Player status"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value as PlayerStatus)}
      className="bg-surface-raised rounded-md border border-transparent px-2 py-1 text-[11px] font-semibold"
    >
      <option value="playing">Playing</option>
      <option value="dropped_out">Dropped out</option>
      <option value="no_show">No-show</option>
    </select>
  );
}

function labelExpense(t: string): string {
  return (
    (
      {
        umpire_fee: "Umpire fee",
        scorer_fee: "Scorer fee",
        match_ball: "Match ball",
        teas: "Teas",
        miscellaneous: "Misc",
      } as Record<string, string>
    )[t] ?? t
  );
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
      <div className="bg-surface-raised mt-1 flex items-baseline gap-1 rounded-xl px-4 py-3 text-3xl">
        <span className="text-text-secondary">£</span>
        <input
          inputMode="decimal"
          pattern="[0-9]*"
          value={amount}
          onChange={(e) => setAmount(e.currentTarget.value)}
          placeholder="0.00"
          className="placeholder:text-text-muted w-full bg-transparent text-3xl font-semibold tracking-[-0.02em] outline-none"
        />
      </div>

      <Eyebrow className="mt-4">Description</Eyebrow>
      <input
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
        placeholder="optional"
        className="border-border bg-surface mt-1 h-11 w-full rounded-lg border px-3 text-sm"
      />

      <Eyebrow className="mt-4">Receipt</Eyebrow>
      <label className="border-border bg-surface-raised text-text-secondary mt-1 flex h-20 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed text-sm">
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
        <p className="text-danger mt-2 text-sm">
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
      <p className="text-text-secondary mt-2 text-center text-[11px]">
        Submitted to the treasurer when you finish the match.
      </p>
    </Sheet>
  );
}

function FinishSheet({
  matchdayId,
  players,
  resolveStatus,
  draftExpenseCount,
  onClose,
  onFinished,
}: {
  matchdayId: string;
  players: MatchdayPlayer[];
  resolveStatus: (p: MatchdayPlayer) => PlayerStatus;
  draftExpenseCount: number;
  onClose: () => void;
  onFinished: () => void;
}) {
  const [result, setResult] = useState<Result>("W");
  // Per-player fee overrides, keyed by matchdayPlayer id, in pounds-as-
  // string so the input is friendly. The API rejects finish until every
  // null-fee playing player has an override entered, surfacing the
  // affected names via the error payload. We parse those names and pin
  // input rows for them here.
  const [overrideInputs, setOverrideInputs] = useState<Record<string, string>>(
    {},
  );
  const [missingNames, setMissingNames] = useState<string[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);

  const playingPlayers = useMemo(
    () => players.filter((p) => resolveStatus(p) === "playing"),
    [players, resolveStatus],
  );

  const missingPlayers = useMemo(
    () =>
      missingNames.length > 0
        ? playingPlayers.filter((p) => missingNames.includes(p.player_name))
        : [],
    [missingNames, playingPlayers],
  );

  const finish = useMutation({
    mutationFn: () => {
      const body: {
        resultType: Result;
        playerStatuses: Array<{
          matchdayPlayerId: string;
          status: PlayerStatus;
        }>;
        feeOverrides: Array<{ matchdayPlayerId: string; amountPence: number }>;
      } = {
        resultType: result,
        playerStatuses: players.map((p) => ({
          matchdayPlayerId: p.id,
          status: resolveStatus(p),
        })),
        feeOverrides: Object.entries(overrideInputs).flatMap(
          ([matchdayPlayerId, raw]) => {
            const parsed = Math.round(parseFloat(raw || "0") * 100);
            if (!Number.isFinite(parsed) || parsed < 0) return [];
            return [{ matchdayPlayerId, amountPence: parsed }];
          },
        ),
      };
      return callApi(
        api.POST("/api/matchday/{matchId}/finish", {
          params: { path: { matchId: matchdayId } },
          body,
        }),
      );
    },
    onSuccess: () => {
      setMissingNames([]);
      setErrorText(null);
      onFinished();
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const match = /Missing fee for: ([^.]+)\./.exec(message);
      if (match) {
        const names = match[1].split(",").map((s) => s.trim());
        setMissingNames(names);
        setErrorText(
          "Some players don't have a fee. Enter the donation amount inline before finishing.",
        );
      } else {
        setErrorText(message);
      }
    },
  });

  return (
    <Sheet onClose={onClose} title="Wrap up match">
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
      <p className="text-text-secondary mt-1 text-[11px]">
        W win · L lose · D draw · T tied · A abandoned · C conceded · N
        no-result
      </p>

      {errorText && (
        <div
          role="alert"
          className="border-danger bg-danger-bg/40 text-danger mt-4 rounded-xl border p-3 text-sm"
        >
          {errorText}
        </div>
      )}

      <div className="bg-surface-raised mt-4 space-y-1 rounded-xl p-3 text-sm">
        <Row label={`${playingPlayers.length} playing`}>
          will be charged · no emails yet
        </Row>
        <Row label={`${draftExpenseCount} draft expenses`}>
          will be submitted
        </Row>
      </div>

      {missingPlayers.length > 0 && (
        <div className="border-warning bg-warning-bg/40 mt-4 space-y-2 rounded-xl border p-3">
          <p className="text-warning text-[11px] font-semibold tracking-[0.06em] uppercase">
            Enter donation
          </p>
          {missingPlayers.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{p.player_name}</span>
              <span className="text-text-secondary">£</span>
              <input
                inputMode="decimal"
                value={overrideInputs[p.id] ?? ""}
                onChange={(e) => {
                  const next = e.currentTarget.value;
                  setOverrideInputs((prev) => ({ ...prev, [p.id]: next }));
                }}
                placeholder="0.00"
                className="border-border bg-surface h-9 w-24 rounded-md border px-2 text-sm"
              />
            </label>
          ))}
        </div>
      )}

      <Button
        tone="primary"
        size="lg"
        className="mt-4 w-full"
        disabled={finish.isPending}
        onClick={() => finish.mutate()}
      >
        {finish.isPending ? "Wrapping…" : "Confirm · create charges"}
      </Button>
      <Button tone="outline" className="mt-2 w-full" onClick={onClose}>
        Cancel
      </Button>
    </Sheet>
  );
}

/**
 * Bottom sheet primitive for the captain-live screens.
 *
 * a11y: announces as a modal dialog (role + aria-modal + aria-labelledby),
 * traps focus inside the panel via an autofocus on the close button +
 * a Tab-cycling wrapper, and dismisses on Esc or backdrop click. Not
 * worth pulling in Radix's `Dialog` just for this — the matchday app
 * already ships a hand-rolled custom Dialog in components/ui/dialog.tsx
 * so we match that house style.
 */
function Sheet({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      // Focus trap — cycle Tab / Shift-Tab inside the panel so
      // keyboard users + VoiceOver rotor can't reach the bottom-nav /
      // content behind the sheet while it's open.
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 md:items-center"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5 pb-[max(env(safe-area-inset-bottom),24px)] shadow-2xl md:rounded-3xl"
      >
        <div className="bg-border mx-auto mb-3 h-1 w-9 rounded-full" />
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-text-secondary grid size-9 place-items-center rounded-md"
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
        "text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase",
        className,
      )}
    >
      {children}
    </p>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-text-secondary">{label}</span>
      <strong className="text-text">{children}</strong>
    </div>
  );
}
