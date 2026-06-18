import { ExpenseTagPicker } from "@/components/expense-tag-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client";
import type { paths } from "@/lib/api.gen";
import {
  EXPENSE_RECEIPT_REQUIRED_ABOVE_PENCE,
  EXPENSE_STATUS_LABELS,
  expenseReceiptRequired,
  type ExpenseStatus,
} from "@percy-main/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatDate, formatPence } from "../admin/status-pill";

type MineResponse =
  paths["/api/expenses/mine"]["get"]["responses"]["200"]["content"]["application/json"];

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

interface FormState {
  description: string;
  amount: string;
  tags: string[];
  receipt: string | null;
  receiptName: string | null;
  error: string | null;
}

const INITIAL_FORM: FormState = {
  description: "",
  amount: "",
  tags: [],
  receipt: null,
  receiptName: null,
  error: null,
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("Could not read the file"));
    };
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

export function Component() {
  useDocumentMeta("My expenses");
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const { data: categories } = useQuery({
    queryKey: ["expenses", "categories"],
    queryFn: () => callApi(api.GET("/api/expense-categories")),
  });

  const { data: mine } = useQuery({
    queryKey: ["expenses", "mine"],
    queryFn: () => callApi(api.GET("/api/expenses/mine")),
  });

  const amountPence = Math.round(parseFloat(form.amount) * 100);
  const amountValid = Number.isFinite(amountPence) && amountPence > 0;
  const receiptRequired = amountValid && expenseReceiptRequired(amountPence);

  const submit = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/expenses", {
          body: {
            description: form.description.trim(),
            amountPence,
            tagNames: form.tags,
            receiptImage: form.receipt,
          },
        }),
      ),
    onSuccess: async () => {
      setForm(INITIAL_FORM);
      await queryClient.invalidateQueries({ queryKey: ["expenses", "mine"] });
    },
    onError: (e: Error) => patch({ error: e.message }),
  });

  const canSubmit =
    form.description.trim().length > 0 &&
    amountValid &&
    (!receiptRequired || !!form.receipt) &&
    !submit.isPending;

  const onFile = async (file: File | undefined) => {
    if (!file) {
      patch({ receipt: null, receiptName: null });
      return;
    }
    try {
      patch({ receipt: await readFileAsDataUrl(file), receiptName: file.name });
    } catch (e) {
      patch({
        error: e instanceof Error ? e.message : "Could not read the file",
      });
    }
  };

  const availableTags = (categories?.categories ?? []).map((c) => c.name);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="mb-6">My expenses</h1>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Submit a claim</h2>
          <div className="space-y-2">
            <Label htmlFor="exp-description">What was it for?</Label>
            <Textarea
              id="exp-description"
              placeholder="e.g. Petrol to the away fixture at Tynemouth"
              value={form.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="exp-amount">Amount (£)</Label>
            <Input
              id="exp-amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => patch({ amount: e.target.value })}
              className="w-40"
            />
          </div>
          <div className="space-y-2">
            <Label>Tags</Label>
            <ExpenseTagPicker
              available={availableTags}
              selected={form.tags}
              onChange={(tags) => patch({ tags })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="exp-receipt">
              Receipt{" "}
              <span className="text-xs text-stone-500">
                (required over{" "}
                {formatPence(EXPENSE_RECEIPT_REQUIRED_ABOVE_PENCE)})
              </span>
            </Label>
            <Input
              id="exp-receipt"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            {form.receiptName && (
              <p className="text-xs text-stone-500">
                Attached: {form.receiptName}
              </p>
            )}
            {receiptRequired && !form.receipt && (
              <p className="text-xs text-amber-600">
                A receipt is required for claims over{" "}
                {formatPence(EXPENSE_RECEIPT_REQUIRED_ABOVE_PENCE)}.
              </p>
            )}
          </div>
          {form.error && <p className="text-sm text-red-600">{form.error}</p>}
          <Button disabled={!canSubmit} onClick={() => submit.mutate()}>
            {submit.isPending ? "Submitting…" : "Submit claim"}
          </Button>
          {submit.isSuccess && (
            <p className="text-sm text-green-700">
              Claim submitted. An approver will review it shortly.
            </p>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">My claims</h2>
          <MyClaims items={mine?.items ?? []} />
        </section>
      </div>
    </div>
  );
}

function MyClaims({ items }: { items: MineResponse["items"] }) {
  if (items.length === 0) {
    return <p className="text-sm text-stone-500">You have no claims yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {items.map((c) => (
        <li key={c.id} className="rounded-md border p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium">{c.description}</p>
              <p className="text-sm text-stone-500">
                {formatPence(c.amountPence)} · submitted{" "}
                {formatDate(c.createdAt)}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {c.tags.map((t) => (
                  <Badge key={t.id} variant="secondary">
                    {t.name}
                  </Badge>
                ))}
              </div>
            </div>
            <Badge variant={STATUS_VARIANT[c.status]}>
              {EXPENSE_STATUS_LABELS[c.status]}
            </Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}
