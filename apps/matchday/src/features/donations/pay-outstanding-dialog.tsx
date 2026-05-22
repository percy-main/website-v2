import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { fmtMoneyPence } from "@/features/format.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { cn } from "@/lib/utils.js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getStripe } from "./stripe.js";

type ChargesResponse = ApiResponse<"/api/charges">;

interface PayOutstandingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chargeIds: string[];
}

/**
 * Mounts <PayBody> only while `open` is true, so opening the dialog
 * triggers a fresh PaymentIntent and closing it tears everything down —
 * no useEffect/setState dances required to keep the two in sync.
 */
export function PayOutstandingDialog({
  open,
  onOpenChange,
  chargeIds,
}: PayOutstandingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pay donations</DialogTitle>
        </DialogHeader>
        {open && (
          <PayBody chargeIds={chargeIds} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Two-step lifecycle:
 *  1. Mount → useQuery fires POST /charges/pay-outstanding to create a
 *     PaymentIntent for the selected chargeIds. Returns clientSecret + total.
 *  2. <Elements> mounts the PaymentElement (Apple Pay / Google Pay come
 *     for free via `automatic_payment_methods` on the server). On submit
 *     we confirm with Stripe, then POST /charges/confirm-payment so the
 *     UI flips to "paid" before the webhook lands.
 */
function PayBody({
  chargeIds,
  onClose,
}: {
  chargeIds: string[];
  onClose: () => void;
}) {
  const intentQuery = useQuery({
    queryKey: ["pay-outstanding", chargeIds],
    queryFn: () =>
      callApi(
        api.POST("/api/charges/pay-outstanding", {
          body: { chargeIds },
        }),
      ),
    enabled: chargeIds.length > 0,
    // PaymentIntent is single-use; the same selection must not be retried
    // silently into a new PI if it 4xxs.
    retry: false,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (chargeIds.length === 0) {
    return (
      <p className="text-danger mt-3 text-sm" role="alert">
        Nothing selected to pay.
      </p>
    );
  }

  if (intentQuery.isError) {
    return (
      <p className="text-danger mt-3 text-sm" role="alert">
        {intentQuery.error instanceof Error
          ? intentQuery.error.message
          : "Couldn't start payment. Try again."}
      </p>
    );
  }

  if (intentQuery.isPending || !intentQuery.data?.clientSecret) {
    if (intentQuery.isSuccess && !intentQuery.data.clientSecret) {
      return (
        <p className="text-danger mt-3 text-sm" role="alert">
          No payable donations in this selection.
        </p>
      );
    }
    return <PreparingState />;
  }

  return (
    <Elements
      stripe={getStripe()}
      options={{
        clientSecret: intentQuery.data.clientSecret,
        appearance: { theme: "stripe" },
      }}
    >
      <PayForm
        totalAmountPence={intentQuery.data.totalAmountPence}
        chargeIds={intentQuery.data.chargeIds}
        onCancel={onClose}
        onPaid={onClose}
      />
    </Elements>
  );
}

function PreparingState() {
  return (
    <div className="mt-4 flex flex-col items-center gap-3 py-8">
      <span
        aria-hidden
        className="border-border border-t-navy size-7 animate-spin rounded-full border-2"
      />
      <p className="text-text-secondary text-sm">Preparing secure payment…</p>
    </div>
  );
}

function PayForm({
  totalAmountPence,
  chargeIds,
  onCancel,
  onPaid,
}: {
  totalAmountPence: number;
  chargeIds: string[];
  onCancel: () => void;
  onPaid: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);

  const pay = useMutation({
    mutationFn: async () => {
      if (!stripe || !elements) {
        throw new Error("Payment isn't ready yet.");
      }

      const submit = await elements.submit();
      if (submit.error) {
        throw new Error(submit.error.message ?? "Payment failed.");
      }

      const { error: confirmError, paymentIntent } =
        await stripe.confirmPayment({
          elements,
          // No funky redirect screens — the Payment Element handles 3DS in-place,
          // and Apple Pay / Google Pay never need a redirect.
          redirect: "if_required",
        });

      if (confirmError) {
        throw new Error(confirmError.message ?? "Payment failed.");
      }

      if (paymentIntent?.id) {
        try {
          await callApi(
            api.POST("/api/charges/confirm-payment", {
              body: { paymentIntentId: paymentIntent.id },
            }),
          );
        } catch {
          // confirm-payment is a UI hint (sets payment_confirmed_at ahead of
          // the webhook); the webhook is authoritative. Don't block the user
          // if it fails — their money is already taken.
        }
      }
    },
    onSuccess: () => {
      // Optimistic cache update. The webhook (which writes `paid_at`) often
      // lands a beat after confirmPayment resolves, and in production the SW
      // serves /api/charges StaleWhileRevalidate — so awaiting a refetch isn't
      // enough to guarantee the user sees the new state. Marking the bundled
      // charges as confirmed locally flips them out of Outstanding instantly;
      // the eventual refetch will reconcile `paid_at` from the webhook.
      const now = new Date().toISOString();
      queryClient.setQueryData<ChargesResponse>(["charges"], (old) => {
        if (!old) return old;
        const ids = new Set(chargeIds);
        return {
          ...old,
          charges: old.charges.map((c) =>
            ids.has(c.id)
              ? { ...c, payment_confirmed_at: c.payment_confirmed_at ?? now }
              : c,
          ),
        };
      });
      // Fire-and-forget the refetch so paid_at lands when the webhook does.
      void queryClient.invalidateQueries({ queryKey: ["charges"] });
      onPaid();
    },
  });

  return (
    // The PaymentElement must stay mounted across the whole confirmPayment
    // round-trip — Stripe throws "elements should have a mounted Payment
    // Element" if we swap it out mid-flight. So the processing UI is an
    // absolutely-positioned overlay; the form behind it is opacity-0'd and
    // pointer-events-none'd, but still in the DOM.
    <div className="relative mt-4">
      <div
        className={cn(
          "flex flex-col gap-4 transition-opacity",
          pay.isPending && "pointer-events-none opacity-0",
        )}
      >
        <PaymentElement
          onReady={() => {
            setReady(true);
          }}
          options={{ layout: "tabs" }}
        />
        {pay.error && (
          <p className="text-danger text-sm" role="alert">
            {pay.error instanceof Error ? pay.error.message : "Payment failed."}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <Button
            tone="primary"
            size="lg"
            onClick={() => {
              pay.mutate();
            }}
            disabled={!stripe || !ready}
          >
            Pay {fmtMoneyPence(totalAmountPence)}
          </Button>
          <Button tone="ghost" onClick={onCancel} type="button">
            Cancel
          </Button>
        </div>
      </div>
      {pay.isPending && (
        <div
          className="bg-surface/95 absolute inset-0 flex flex-col items-center justify-center gap-3 backdrop-blur"
          role="status"
          aria-live="polite"
        >
          <span
            aria-hidden
            className="border-border border-t-navy size-9 animate-spin rounded-full border-[3px]"
          />
          <p className="text-navy text-base font-semibold tracking-[-0.01em] dark:text-white">
            Taking {fmtMoneyPence(totalAmountPence)}…
          </p>
          <p className="text-text-secondary text-sm">
            Hang on — confirming with your bank.
          </p>
        </div>
      )}
    </div>
  );
}
