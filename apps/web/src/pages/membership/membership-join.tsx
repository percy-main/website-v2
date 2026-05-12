import {
  MemberDetails,
  useMemberDetails,
} from "@/components/members/member-details";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useDocumentMeta } from "@/hooks/use-document-meta";
import { useSession } from "@/lib/auth-client";
import { Link } from "react-router";

function JoinWizardInner() {
  const session = useSession();
  const memberQuery = useMemberDetails();

  if (!session.data || memberQuery.isLoading) return null;

  const email = session.data.user.email;
  const hasDetails = !!memberQuery.data?.member;

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Join Percy Main Community Sports Club</CardTitle>
        </CardHeader>
        <CardContent>
          {hasDetails ? (
            <div className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">
              Your details are already on file. You can proceed to payment.
            </div>
          ) : (
            <MemberDetails />
          )}
        </CardContent>
        <CardFooter className="flex justify-between">
          <Link
            to={`/membership/pay?email=${encodeURIComponent(email)}`}
            className={buttonVariants()}
          >
            Choose Membership
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}

export function Component() {
  useDocumentMeta("Join The Club");
  return <JoinWizardInner />;
}
