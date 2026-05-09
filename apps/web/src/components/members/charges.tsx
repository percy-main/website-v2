import { PaymentForm } from "@/components/payment-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
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
import { useState } from "react";

const currencyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function Charges() {
  const queryClient = useQueryClient();
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentData, setPaymentData] = useState<{
    clientSecret: string;
    totalAmountPence: number;
    paymentIntentId: string;
  } | null>(null);

  const query = useQuery({
    queryKey: ["myCharges"],
    queryFn: () => callApi(api.GET("/api/charges")),
  });

  const payMutation = useMutation({
    mutationFn: () => callApi(api.POST("/api/charges/pay-outstanding")),
    onSuccess: (data) => {
      if (data.clientSecret) {
        const piId = data.clientSecret.split("_secret_")[0];
        setPaymentData({
          clientSecret: data.clientSecret,
          totalAmountPence: data.totalAmountPence,
          paymentIntentId: piId,
        });
      }
      // Refresh charges so any newly-attached payment intent state is visible.
      void queryClient.invalidateQueries({ queryKey: ["myCharges"] });
    },
    onError: () => {
      setPaymentError("Failed to create payment. Please try again.");
    },
  });

  const charges = query.data?.charges;

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

  const unpaidCharges = charges.filter(
    (c) => !c.paid_at && !c.payment_confirmed_at,
  );
  const totalOutstandingPence = unpaidCharges.reduce(
    (sum, c) => sum + c.amount_pence,
    0,
  );

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
    <div className="flex flex-col gap-4">
      <h2 className="text-h4 mb-0">Payments</h2>

      {unpaidCharges.length > 0 && (
        <Card>
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <CardTitle className="text-base">
                Outstanding balance:{" "}
                {currencyFormatter.format(totalOutstandingPence / 100)}
              </CardTitle>
              <CardDescription>
                {unpaidCharges.length} unpaid{" "}
                {unpaidCharges.length === 1 ? "payment" : "payments"}
              </CardDescription>
            </div>
            <Button
              onClick={() => {
                setPaymentError(null);
                payMutation.mutate();
              }}
              disabled={payMutation.isPending}
            >
              {payMutation.isPending
                ? "Processing…"
                : "Pay Outstanding Balance"}
            </Button>
          </CardContent>
          {paymentError && (
            <CardContent className="pt-0">
              <Alert variant="destructive">
                <AlertDescription>{paymentError}</AlertDescription>
              </Alert>
            </CardContent>
          )}
        </Card>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {charges.map((charge) => (
            <TableRow key={charge.id}>
              <TableCell>
                {formatDate(charge.charge_date, "dd/MM/yyyy")}
              </TableCell>
              <TableCell>{charge.description}</TableCell>
              <TableCell>
                {currencyFormatter.format(charge.amount_pence / 100)}
              </TableCell>
              <TableCell>
                {charge.paid_at ? (
                  <Badge variant="success">Paid</Badge>
                ) : charge.payment_confirmed_at ? (
                  <Badge variant="info">Pending</Badge>
                ) : (
                  <Badge variant="warning">Unpaid</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
