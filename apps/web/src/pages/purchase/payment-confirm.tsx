import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link, useSearchParams } from "react-router";

export function Component() {
  const [searchParams] = useSearchParams();
  const status = searchParams.get("redirect_status");

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
