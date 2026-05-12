import { PaymentForm } from "@/components/payment-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, callApi } from "@/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate } from "date-fns";
import { useMemo, useState } from "react";

const currencyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type ChargeRow = NonNullable<
  NonNullable<ReturnType<typeof useChargesQuery>["data"]>
>["charges"][number];

function useChargesQuery() {
  return useQuery({
    queryKey: ["myCharges"],
    queryFn: () => callApi(api.GET("/api/charges")),
  });
}

export function Charges() {
  const queryClient = useQueryClient();
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentData, setPaymentData] = useState<{
    clientSecret: string;
    totalAmountPence: number;
    paymentIntentId: string;
  } | null>(null);

  const query = useChargesQuery();
  const charges = query.data?.charges;

  const unpaidCharges = useMemo(
    () =>
      charges?.filter(
        (c) => !c.paid_at && !c.payment_confirmed_at && !c.relieved_at,
      ) ?? [],
    [charges],
  );
  const historyCharges = useMemo(
    () =>
      charges?.filter(
        (c) =>
          c.paid_at !== null ||
          c.payment_confirmed_at !== null ||
          c.relieved_at !== null,
      ) ?? [],
    [charges],
  );

  // Track explicit deselections rather than selections so new unpaid
  // charges arriving (e.g. on a refresh) are selected by default
  // without needing an effect to sync state.
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set());

  const selectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of unpaidCharges) {
      if (!deselectedIds.has(c.id)) ids.add(c.id);
    }
    return ids;
  }, [unpaidCharges, deselectedIds]);

  const payMutation = useMutation({
    mutationFn: (chargeIds: string[]) =>
      callApi(
        api.POST("/api/charges/pay-outstanding", {
          body: { chargeIds },
        }),
      ),
    onSuccess: (data) => {
      if (data.clientSecret) {
        const piId = data.clientSecret.split("_secret_")[0];
        setPaymentData({
          clientSecret: data.clientSecret,
          totalAmountPence: data.totalAmountPence,
          paymentIntentId: piId,
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["myCharges"] });
    },
    onError: () => {
      setPaymentError("Failed to create payment. Please try again.");
    },
  });

  if (query.isLoading) {
    return null;
  }

  if (!charges || charges.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-h4 mb-0">Payments</h2>
        <p className="text-sm text-stone-500">No payments yet.</p>
      </div>
    );
  }

  if (paymentData) {
    return (
      <PaymentForm
        clientSecret={paymentData.clientSecret}
        amount={paymentData.totalAmountPence}
        title="Pay Outstanding Balance"
        onSuccess={() => {
          callApi(
            api.POST("/api/charges/confirm-payment", {
              body: { paymentIntentId: paymentData.paymentIntentId },
            }),
          )
            .catch(() => {
              // Payment succeeded at Stripe; webhook will reconcile if confirm fails.
            })
            .finally(() => {
              setPaymentData(null);
              void queryClient.invalidateQueries({ queryKey: ["myCharges"] });
            });
        }}
        onCancel={() => setPaymentData(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-h4 mb-0">Payments</h2>

      <OutstandingSection
        unpaidCharges={unpaidCharges}
        selectedIds={selectedIds}
        onToggleCharge={(id, checked) =>
          setDeselectedIds((prev) => {
            const next = new Set(prev);
            if (checked) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onToggleAll={(checked) =>
          setDeselectedIds(
            checked ? new Set() : new Set(unpaidCharges.map((c) => c.id)),
          )
        }
        onPay={() => {
          setPaymentError(null);
          payMutation.mutate(Array.from(selectedIds));
        }}
        isPending={payMutation.isPending}
        error={paymentError}
      />

      <HistorySection historyCharges={historyCharges} />
    </div>
  );
}

function OutstandingSection({
  unpaidCharges,
  selectedIds,
  onToggleCharge,
  onToggleAll,
  onPay,
  isPending,
  error,
}: {
  unpaidCharges: ChargeRow[];
  selectedIds: Set<string>;
  onToggleCharge: (id: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onPay: () => void;
  isPending: boolean;
  error: string | null;
}) {
  if (unpaidCharges.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outstanding payments</CardTitle>
          <CardDescription>You&apos;re all paid up.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const selectedCharges = unpaidCharges.filter((c) => selectedIds.has(c.id));
  const totalSelectedPence = selectedCharges.reduce(
    (sum, c) => sum + c.amount_pence,
    0,
  );
  const allSelected = selectedIds.size === unpaidCharges.length;
  const noneSelected = selectedIds.size === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Outstanding payments ({unpaidCharges.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all unpaid charges"
                  checked={allSelected}
                  onCheckedChange={(checked) => onToggleAll(checked === true)}
                />
              </TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {unpaidCharges.map((charge) => (
              <TableRow key={charge.id}>
                <TableCell>
                  <Checkbox
                    aria-label={`Select charge ${charge.description}`}
                    checked={selectedIds.has(charge.id)}
                    onCheckedChange={(checked) =>
                      onToggleCharge(charge.id, checked === true)
                    }
                  />
                </TableCell>
                <TableCell>
                  {formatDate(charge.charge_date, "dd/MM/yyyy")}
                </TableCell>
                <TableCell>
                  <div>{charge.description}</div>
                  {charge.on_behalf_of && (
                    <div className="text-xs text-stone-500">
                      For {charge.on_behalf_of.name ?? "linked junior"}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {currencyFormatter.format(charge.amount_pence / 100)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between border-t border-stone-200 pt-4">
          <div>
            <p className="text-sm text-stone-500">
              Paying {selectedCharges.length} of {unpaidCharges.length}: total
            </p>
            <p className="text-h5 mb-0">
              {currencyFormatter.format(totalSelectedPence / 100)}
            </p>
          </div>
          <Button
            onClick={onPay}
            disabled={isPending || noneSelected}
            size="lg"
          >
            {isPending ? "Processing…" : "Pay selected"}
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function HistorySection({ historyCharges }: { historyCharges: ChargeRow[] }) {
  if (historyCharges.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-stone-700">Payment history</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {historyCharges.map((charge) => (
            <TableRow key={charge.id}>
              <TableCell>
                {formatDate(charge.charge_date, "dd/MM/yyyy")}
              </TableCell>
              <TableCell>
                <div>{charge.description}</div>
                {charge.on_behalf_of && (
                  <div className="text-xs text-stone-500">
                    For {charge.on_behalf_of.name ?? "linked junior"}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right">
                {currencyFormatter.format(charge.amount_pence / 100)}
              </TableCell>
              <TableCell>
                {charge.paid_at ? (
                  <Badge variant="success">Paid</Badge>
                ) : charge.relieved_at ? (
                  <Badge variant="secondary">Waived</Badge>
                ) : (
                  <Badge variant="info">Pending</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
