import { StatusPill } from "@/components/primitives/status-pill.js";
import { Card, CardEyebrow } from "@/components/ui/card.js";
import { fmtDate } from "@/features/format.js";
import { api, callApi } from "@/lib/api-client.js";
import { useQuery } from "@tanstack/react-query";
import { differenceInDays, isPast, parseISO } from "date-fns";
import { IdCardIcon } from "lucide-react";

const MEMBERSHIP_LABELS: Record<string, string> = {
  senior_player: "Senior Playing Member",
  senior_women_player: "Women's Playing Member",
  social: "Social Member",
  junior: "Junior Member",
  concessionary: "Student / Concessionary",
};

function membershipLabel(type: string | null): string {
  if (!type) return "Member";
  return MEMBERSHIP_LABELS[type] ?? "Member";
}

type MembershipStatus =
  | { tone: "success"; label: "Active" }
  | { tone: "warning"; label: "Expires soon" }
  | { tone: "danger"; label: "Expired" };

function computeStatus(paidUntil: string): MembershipStatus {
  const expiry = parseISO(paidUntil);
  if (isPast(expiry)) return { tone: "danger", label: "Expired" };
  const days = differenceInDays(expiry, new Date());
  if (days <= 30) return { tone: "warning", label: "Expires soon" };
  return { tone: "success", label: "Active" };
}

export function MembershipCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["members", "me", "membership"],
    queryFn: () => callApi(api.GET("/api/members/me/membership")),
  });

  if (isLoading || isError) return null;
  const membership = data?.membership;

  return (
    <Card className="mx-4 mb-4 p-4">
      <CardEyebrow icon={IdCardIcon}>Your membership</CardEyebrow>
      {membership ? (
        <ActiveMembership
          category={membershipLabel(membership.type)}
          paidUntil={membership.paid_until}
        />
      ) : (
        <NoMembership />
      )}
    </Card>
  );
}

function ActiveMembership({
  category,
  paidUntil,
}: {
  category: string;
  paidUntil: string;
}) {
  const status = computeStatus(paidUntil);
  return (
    <>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <p className="text-navy text-lg font-semibold tracking-[-0.01em] dark:text-white">
          {category}
        </p>
        <StatusPill tone={status.tone} dot>
          {status.label}
        </StatusPill>
      </div>
      <p className="text-text-secondary mt-1 text-sm">
        Paid until {fmtDate(paidUntil, "d MMM yyyy")}
      </p>
    </>
  );
}

function NoMembership() {
  return (
    <>
      <p className="text-navy mt-1.5 text-lg font-semibold tracking-[-0.01em] dark:text-white">
        Not a member yet
      </p>
      <p className="text-text-secondary mt-1 text-sm">
        Join on the main site to play, train, or support the club.
      </p>
    </>
  );
}
