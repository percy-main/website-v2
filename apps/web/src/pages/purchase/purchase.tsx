import { PaymentForm } from "@/components/payment-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router";

const currencyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type State =
  | { step: "ready" }
  | {
      step: "paying";
      clientSecret: string;
      amount: number;
      productName: string;
    }
  | { step: "success"; productName: string };

export function Component() {
  const { priceId } = useParams<{ priceId: string }>();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<State>({ step: "ready" });
  const [quantity, setQuantity] = useState(1);
  const [customAmount, setCustomAmount] = useState<string>("");

  const metadata = searchParams.get("metadata");
  const email = searchParams.get("email");
  const isSubscription = searchParams.get("type") === "subscription";

  const { data: priceInfo, isLoading: priceLoading } = useQuery({
    queryKey: ["price", priceId],
    queryFn: () =>
      callApi(
        api.GET("/api/price/{priceId}", {
          params: { path: { priceId: priceId ?? "" } },
        }),
      ),
    enabled: !!priceId,
    staleTime: 5 * 60_000,
  });

  useDocumentMeta(priceInfo?.productName ?? "Purchase");

  // Set the preset once price info loads
  const presetApplied = useState(false);
  if (priceInfo?.customAmount?.preset && !presetApplied[0]) {
    setCustomAmount(String(priceInfo.customAmount.preset / 100));
    presetApplied[1](true);
  }

  const customAmountPence = priceInfo?.customAmount
    ? Math.round(parseFloat(customAmount || "0") * 100)
    : undefined;

  const totalAmount = priceInfo?.customAmount
    ? (customAmountPence ?? 0)
    : (priceInfo?.unitAmount ?? 0) * quantity;

  const isValidAmount = priceInfo?.customAmount
    ? totalAmount >= (priceInfo.customAmount.min ?? 0) &&
      (!priceInfo.customAmount.max || totalAmount <= priceInfo.customAmount.max)
    : totalAmount > 0;

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      let parsed: Record<string, unknown> | undefined;
      if (metadata) {
        try {
          parsed = JSON.parse(metadata) as Record<string, unknown>;
        } catch {
          throw new Error("Invalid metadata parameter");
        }
      }

      if (isSubscription) {
        if (!email) throw new Error("Email is required for subscriptions");
        const membership = parsed?.membership as
          | "social"
          | "senior_player"
          | "senior_women_player"
          | "concessionary";
        const result = await callApi(
          api.POST("/api/subscribe", {
            body: {
              priceId: priceId ?? "",
              email,
              membership,
            },
          }),
        );
        return {
          clientSecret: result.clientSecret,
          amount: 0,
          productName: "Subscription",
        };
      }

      return await callApi(
        api.POST("/api/purchase", {
          body: {
            priceId: priceId ?? "",
            quantity,
            customAmountPence,
            metadata: parsed as Record<string, string> | undefined,
            email: email ?? undefined,
          },
        }),
      );
    },
    onSuccess: (data) => {
      if (!data.clientSecret) return;
      setState({
        step: "paying",
        clientSecret: data.clientSecret,
        amount: data.amount,
        productName: data.productName,
      });
    },
  });

  if (state.step === "success") {
    return (
      <div className="container mx-auto max-w-lg px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Payment Successful</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              Thank you for your purchase of {state.productName}. You will
              receive a confirmation email shortly.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.step === "paying") {
    return (
      <div className="container mx-auto max-w-lg px-4 py-8">
        <PaymentForm
          clientSecret={state.clientSecret}
          amount={state.amount}
          title={state.productName}
          onSuccess={() =>
            setState({ step: "success", productName: state.productName })
          }
          onCancel={() => setState({ step: "ready" })}
        />
      </div>
    );
  }

  if (priceLoading || !priceInfo) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-8">
        <Card>
          <CardContent className="py-8 text-center text-sm text-stone-500">
            Loading...
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-lg px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>{priceInfo.productName}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {priceInfo.customAmount ? (
            <div className="flex items-center justify-between">
              <label htmlFor="customAmount">Amount</label>
              <div className="flex items-center gap-1">
                <span>£</span>
                <input
                  id="customAmount"
                  type="number"
                  min={priceInfo.customAmount.min / 100}
                  max={
                    priceInfo.customAmount.max
                      ? priceInfo.customAmount.max / 100
                      : undefined
                  }
                  step="0.01"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  className="w-24 rounded border px-2 py-1 text-right"
                />
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span>Price</span>
                <span>{priceInfo.formattedPrice} each</span>
              </div>
              {priceInfo.qtyAdjustable && (
                <div className="flex items-center justify-between">
                  <label htmlFor="quantity">Quantity</label>
                  <input
                    id="quantity"
                    type="number"
                    min={1}
                    max={priceInfo.maxQty}
                    value={quantity}
                    onChange={(e) =>
                      setQuantity(Math.max(1, parseInt(e.target.value) || 1))
                    }
                    className="w-20 rounded border px-2 py-1 text-right"
                  />
                </div>
              )}
            </>
          )}
          <div className="flex items-center justify-between border-t pt-4 font-semibold">
            <span>Total</span>
            <span>{currencyFormatter.format(totalAmount / 100)}</span>
          </div>
          {purchaseMutation.error && (
            <Alert variant="destructive">
              <AlertDescription>
                Something went wrong creating your payment. Please try again.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            onClick={() => purchaseMutation.mutate()}
            disabled={purchaseMutation.isPending || !isValidAmount}
          >
            {purchaseMutation.isPending
              ? "Processing…"
              : `Pay ${currencyFormatter.format(totalAmount / 100)}`}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
