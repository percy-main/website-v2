import {
  MemberDetails,
  useMemberDetails,
} from "@/components/members/member-details";
import { StampLink } from "@/components/theme/bits.js";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useDocumentMeta } from "@/hooks/use-document-meta";
import { useSession } from "@/lib/auth-client";

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
          <CardTitle className="fc-two-tone">
            Join Percy Main Community Sports Club
          </CardTitle>
        </CardHeader>
        <CardContent>
          {hasDetails ? (
            <div className="border-primary bg-surface text-primary border-2 p-3 text-sm">
              Your details are already on file. You can proceed to payment.
            </div>
          ) : (
            <MemberDetails />
          )}
        </CardContent>
        <CardFooter className="flex justify-between">
          <StampLink to={`/membership/pay?email=${encodeURIComponent(email)}`}>
            Choose Membership →
          </StampLink>
        </CardFooter>
      </Card>
    </div>
  );
}

export function Component() {
  useDocumentMeta("Join The Club");
  return <JoinWizardInner />;
}
