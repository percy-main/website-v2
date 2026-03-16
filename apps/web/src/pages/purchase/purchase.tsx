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
import { api } from "@/lib/api";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router";

interface PurchaseResponse {
  clientSecret: string;
  amount: number;
  productName: string;
}

interface SubscribeResponse {
  clientSecret: string;
  subscriptionId: string;
}

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

  const metadata = searchParams.get("metadata");
  const email = searchParams.get("email");
  const isSubscription = searchParams.get("type") === "subscription";

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
        const result = await api.post<SubscribeResponse>("/subscribe", {
          priceId,
          email,
          metadata: parsed,
        });
        return {
          clientSecret: result.clientSecret,
          amount: 0,
          productName: "Subscription",
        };
      }

      return await api.post<PurchaseResponse>("/purchase", {
        priceId,
        quantity: 1,
        metadata: parsed,
        email: email ?? undefined,
      });
    },
    onSuccess: (data) => {
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

  return (
    <div className="container mx-auto max-w-lg px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Complete Your Payment</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {purchaseMutation.error && (
            <Alert variant="destructive">
              <AlertDescription>
                Something went wrong creating your payment. Please try again.
              </AlertDescription>
            </Alert>
          )}
          <p className="text-sm text-gray-600">
            Click below to proceed to payment.
          </p>
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            onClick={() => purchaseMutation.mutate()}
            disabled={purchaseMutation.isPending}
          >
            {purchaseMutation.isPending
              ? "Processing..."
              : "Proceed to Payment"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
