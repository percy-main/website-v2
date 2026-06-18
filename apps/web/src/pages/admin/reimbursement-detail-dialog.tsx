import { ExpenseTagPicker } from "@/components/expense-tag-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api, callApi } from "@/lib/api-client";
import type { paths } from "@/lib/api.gen";
import { EXPENSE_STATUS_LABELS, type ExpenseStatus } from "@percy-main/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatDate, formatPence } from "./status-pill";

type DetailResponse =
  paths["/api/expenses/{expenseId}"]["get"]["responses"]["200"]["content"]["application/json"];

const STATUS_VARIANT: Record<
  ExpenseStatus,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  pending: "default",
  awaiting_second_approval: "warning",
  approved: "success",
  denied: "destructive",
  paid: "secondary",
  payout_failed: "destructive",
};

export function ReimbursementDetailDialog({
  expenseId,
  availableTags,
  canApprove,
  canPay,
  onClose,
}: {
  expenseId: string | null;
  availableTags: readonly string[];
  canApprove: boolean;
  canPay: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={!!expenseId}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Expense claim</DialogTitle>
        </DialogHeader>
        {/* key={expenseId} resets the body's local edit state per claim. */}
        {expenseId && (
          <DetailBody
            key={expenseId}
            expenseId={expenseId}
            availableTags={availableTags}
            canApprove={canApprove}
            canPay={canPay}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({
  expenseId,
  availableTags,
  canApprove,
  canPay,
}: {
  expenseId: string;
  availableTags: readonly string[];
  canApprove: boolean;
  canPay: boolean;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [editedTags, setEditedTags] = useState<string[] | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", "detail", expenseId],
    queryFn: () =>
      callApi(
        api.GET("/api/expenses/{expenseId}", {
          params: { path: { expenseId } },
        }),
      ),
  });

  const loadedTags = data?.tags.map((t) => t.name) ?? [];
  const selectedTags = editedTags ?? loadedTags;

  const decide = useMutation({
    mutationFn: (decision: "approve" | "deny") =>
      callApi(
        api.POST("/api/expenses/{expenseId}/decision", {
          params: { path: { expenseId } },
          body: {
            decision,
            note: note.trim() || null,
            ...(decision === "approve" ? { tagNames: selectedTags } : {}),
          },
        }),
      ),
    onSuccess: async () => {
      setNote("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const markPaid = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/expenses/{expenseId}/mark-paid", {
          params: { path: { expenseId } },
          body: { note: note.trim() || null },
        }),
      ),
    onSuccess: async () => {
      setNote("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const payout = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/expenses/{expenseId}/payout", {
          params: { path: { expenseId } },
        }),
      ),
    onSuccess: async () => {
      setError(null);
      // If there's no payout method on file yet, the result carries a hosted
      // link (read off payout.data below) for the claimant to add bank details.
      await queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (isLoading || !data) {
    return <p className="text-stone-500">Loading…</p>;
  }

  const expense = data.expense;
  const decidable =
    expense.status === "pending" ||
    expense.status === "awaiting_second_approval";
  const payable =
    expense.status === "approved" || expense.status === "payout_failed";
  const busy = decide.isPending || markPaid.isPending || payout.isPending;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-stone-500">Claimant</p>
          <p>{expense.claimantName}</p>
        </div>
        <div>
          <p className="text-stone-500">Amount</p>
          <p className="font-medium">{formatPence(expense.amountPence)}</p>
        </div>
        <div className="col-span-2">
          <p className="text-stone-500">Description</p>
          <p>{expense.description}</p>
        </div>
        <div>
          <p className="text-stone-500">Status</p>
          <Badge variant={STATUS_VARIANT[expense.status]}>
            {EXPENSE_STATUS_LABELS[expense.status]}
          </Badge>
        </div>
        <div>
          <p className="text-stone-500">Approvals needed</p>
          <p>{expense.needsTwoApprovers ? "Two" : "One"}</p>
        </div>
        {expense.payoutFailureReason && (
          <div className="col-span-2">
            <p className="text-stone-500">Payout failure</p>
            <p className="text-red-600">{expense.payoutFailureReason}</p>
          </div>
        )}
      </div>

      <TagsSection tags={data.tags} />

      <div className="border-t pt-3">
        <h4 className="mb-2 text-sm font-medium">Decisions</h4>
        {data.approvals.length === 0 ? (
          <p className="text-sm text-stone-400">No decisions yet</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.approvals.map((a) => (
              <li key={a.id} className="flex justify-between">
                <span>
                  {a.approverName ?? "Unknown"} -{" "}
                  {a.decision === "approved" ? "Approved" : "Denied"}
                  {a.note ? `: ${a.note}` : ""}
                </span>
                <span className="text-stone-500">
                  {formatDate(a.createdAt, true)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t pt-3">
        <h4 className="mb-2 text-sm font-medium">Audit trail</h4>
        <ul className="space-y-1 text-sm">
          {data.events.map((e) => (
            <li key={e.id} className="flex justify-between">
              <span>
                {e.type}
                {e.actorName ? ` by ${e.actorName}` : ""}
                {e.note ? `: ${e.note}` : ""}
              </span>
              <span className="text-stone-500">
                {formatDate(e.createdAt, true)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {expense.receiptImageUrl && (
        <div className="border-t pt-3">
          <h4 className="mb-2 text-sm font-medium">Receipt</h4>
          <button
            type="button"
            onClick={() => setLightboxUrl(expense.receiptImageUrl)}
            className="cursor-pointer"
            aria-label="Open receipt full size"
          >
            <img
              src={expense.receiptImageUrl}
              alt="Receipt"
              className="max-h-48 rounded border object-contain"
            />
          </button>
        </div>
      )}

      {(canApprove && decidable) || (canPay && payable) ? (
        <div className="space-y-3 border-t pt-3">
          {canApprove && decidable && (
            <div>
              <p className="mb-1 text-sm text-stone-500">
                Tags (set when approving)
              </p>
              <ExpenseTagPicker
                available={availableTags}
                selected={selectedTags}
                onChange={setEditedTags}
              />
            </div>
          )}
          <Textarea
            placeholder="Note (optional, shared with the claimant on a decision)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {canApprove && decidable && (
              <>
                <Button
                  disabled={busy}
                  onClick={() => decide.mutate("approve")}
                >
                  Approve
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => decide.mutate("deny")}
                >
                  Deny
                </Button>
              </>
            )}
            {canPay && payable && (
              <>
                <Button disabled={busy} onClick={() => payout.mutate()}>
                  Pay via Stripe
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => markPaid.mutate()}
                >
                  Mark paid (manual)
                </Button>
              </>
            )}
          </div>
          {payout.data?.onboardingUrl && (
            <p className="text-sm text-amber-700">
              The claimant needs to add their bank details first.{" "}
              <a
                href={payout.data.onboardingUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Open the secure Stripe setup link
              </a>{" "}
              and share it with them, then pay again.
            </p>
          )}
        </div>
      ) : null}

      {lightboxUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Receipt full size"
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLightboxUrl(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
              setLightboxUrl(null);
            }
          }}
        >
          <img
            src={lightboxUrl}
            alt="Receipt full size"
            className="max-h-[90vh] max-w-[90vw] object-contain"
          />
        </div>
      )}
    </div>
  );
}

function TagsSection({ tags }: { tags: DetailResponse["tags"] }) {
  return (
    <div className="border-t pt-3">
      <p className="mb-1 text-sm text-stone-500">Tags</p>
      <div className="flex flex-wrap gap-2">
        {tags.length === 0 ? (
          <span className="text-sm text-stone-400">No tags</span>
        ) : (
          tags.map((t) => (
            <Badge key={t.id} variant="secondary">
              {t.name}
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}
