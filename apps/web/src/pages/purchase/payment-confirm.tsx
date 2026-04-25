import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { trackEvent } from "@/lib/marketing/gtag.js";
import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";

export function Component() {
  useDocumentMeta("Payment");
  const [searchParams] = useSearchParams();
  const status = searchParams.get("redirect_status");

  useEffect(() => {
    if (status === "succeeded") {
      // Stripe's redirect carries no value/currency in the URL, but the
      // server-side webhook records the authoritative purchase event. This
      // browser-side fire is for GA4 reporting only.
      trackEvent("purchase", { currency: "GBP" });
    }
  }, [status]);

  return (
    <div className="container mx-auto max-w-lg px-4 py-8">
      {status === "succeeded" ? (
        <Card>
          <CardHeader>
            <CardTitle>Payment Successful</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              Thank you for your payment. You will receive a confirmation email
              shortly.
            </p>
            <Link
              to="/members"
              className="mt-4 inline-block text-sm text-blue-600 hover:underline"
            >
              Go to Members Area
            </Link>
          </CardContent>
        </Card>
      ) : status === "processing" ? (
        <Card>
          <CardHeader>
            <CardTitle>Payment Processing</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              Your payment is being processed. You will receive a confirmation
              email once it is complete.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Payment Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              Something went wrong with your payment. Please go back and try
              again.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
