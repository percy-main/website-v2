import { ChangePassword } from "@/components/members/change-password";
import { Charges } from "@/components/members/charges";
import { Documents } from "@/components/members/documents";
import { FinancialReliefStatus } from "@/components/members/financial-relief-status";
import {
  MemberDetails,
  useMemberDetails,
} from "@/components/members/member-details";
import { Membership } from "@/components/members/membership";
import { Passkeys } from "@/components/members/passkeys";
import { Subscriptions } from "@/components/members/subscriptions";
import { TwoFactor } from "@/components/members/two-factor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import {
  useHasAdminPanelAccess,
  useHasPermission,
} from "@/hooks/use-has-permission.js";
import { api, callApi } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";

const TABS = [
  "membership",
  "details",
  "security",
  "payments",
  "documents",
] as const;
type Tab = (typeof TABS)[number];

function isValidTab(value: string | null): value is Tab {
  return TABS.includes(value as Tab);
}

export function Component() {
  useDocumentMeta("Members Area");
  const { data: session } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = isValidTab(tabParam) ? tabParam : "membership";

  const onTabChange = (value: string) => {
    setSearchParams(value === "membership" ? {} : { tab: value }, {
      replace: true,
    });
  };

  const hasAdminAccess = useHasAdminPanelAccess();
  const hasJuniorAccess = useHasPermission("juniors", "view").allowed;

  // Only members whose account is slug-linked to a player profile have
  // something to edit; the link is hidden otherwise.
  const { data: profileEditState } = useQuery({
    queryKey: ["profile", "edit"],
    queryFn: () => callApi(api.GET("/api/profile/edit")),
  });
  const hasEditableProfile = profileEditState?.profile != null;

  if (!session) return null;

  const { user } = session;

  return (
    <div className="container mx-auto px-4 py-8">
      <OnboardingModal onGoToDetails={() => onTabChange("details")} />

      <div className="flex flex-col items-start justify-stretch gap-4">
        <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1>Members Area</h1>
          <div className="flex flex-wrap gap-2">
            {hasAdminAccess && (
              <Link
                className="rounded border border-stone-800 px-3 py-1.5 text-sm text-stone-900 hover:bg-stone-200"
                to="/admin"
              >
                Admin Panel
              </Link>
            )}

            {hasJuniorAccess && (
              <Link
                className="rounded border border-stone-800 px-3 py-1.5 text-sm text-stone-900 hover:bg-stone-200"
                to="/junior-manager"
              >
                Junior Teams
              </Link>
            )}

            <a
              className="rounded border border-stone-800 px-3 py-1.5 text-sm text-stone-900 hover:bg-stone-200"
              href={
                (import.meta.env.VITE_MATCHDAY_URL as string | undefined) ??
                "https://matchday.percymain.org"
              }
            >
              Matchday
            </a>
            <Link
              className="rounded border border-stone-800 px-3 py-1.5 text-sm text-stone-900 hover:bg-stone-200"
              to="/members/fantasy"
            >
              Fantasy Cricket
            </Link>
            {hasEditableProfile && (
              <Link
                className="rounded border border-stone-800 px-3 py-1.5 text-sm text-stone-900 hover:bg-stone-200"
                to="/members/profile"
              >
                Edit my profile
              </Link>
            )}
            <ScoutLink />
            <Link
              className="rounded border border-stone-800 px-3 py-1.5 text-sm text-stone-900 hover:bg-stone-200"
              to="/auth/logout"
            >
              Sign Out
            </Link>
          </div>
        </div>
        <Tabs value={tab} onValueChange={onTabChange} className="w-full">
          <TabsList>
            <TabsTrigger value="membership">Membership</TabsTrigger>
            <TabsTrigger value="details">Your Details</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>
          <IncompleteDetailsBanner hidden={tab === "details"} />
          <AvailabilityBanner />
          <TabsContent value="membership">
            <div className="flex flex-col gap-4">
              <div>
                <h2>{user.name}</h2>
                <p>{user.email}</p>
              </div>
              <Membership />
            </div>
          </TabsContent>
          <TabsContent value="details">
            <MemberDetails userName={user.name} />
          </TabsContent>
          <TabsContent value="security">
            <div className="flex flex-col gap-4">
              <ChangePassword />
              <Passkeys />
              <TwoFactor user={user} />
            </div>
          </TabsContent>
          <TabsContent value="payments">
            <div className="flex flex-col gap-8">
              <FinancialReliefStatus />
              <Charges />
              <Subscriptions />
            </div>
          </TabsContent>
          <TabsContent value="documents">
            <Documents />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

const ONBOARDING_DISMISSED_KEY = "pmcsc_onboarding_dismissed";

function hasMemberDetails(
  member: { name: string | null } | null | undefined,
): boolean {
  return !!member?.name;
}

function OnboardingModal({ onGoToDetails }: { onGoToDetails: () => void }) {
  const query = useMemberDetails();
  const [dismissed, setDismissed] = useState(
    () =>
      typeof localStorage !== "undefined" &&
      !!localStorage.getItem(ONBOARDING_DISMISSED_KEY),
  );

  const open =
    !dismissed && !query.isLoading && !hasMemberDetails(query.data?.member);

  const dismiss = () => {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
    setDismissed(true);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && dismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Welcome to Percy Main!</DialogTitle>
          <DialogDescription>
            Thanks for creating an account. To get the most out of your
            membership, we recommend completing your details, but you can do
            this at any time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={dismiss}>
            Maybe Later
          </Button>
          <Button
            onClick={() => {
              dismiss();
              onGoToDetails();
            }}
          >
            Complete Your Details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IncompleteDetailsBanner({ hidden }: { hidden: boolean }) {
  const query = useMemberDetails();

  if (hidden || query.isLoading || hasMemberDetails(query.data?.member))
    return null;

  return (
    <div className="w-full rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
      Your details are incomplete. Please go to the{" "}
      <strong>Your Details</strong> tab to fill them in.
    </div>
  );
}

function AvailabilityBanner() {
  const { data } = useQuery({
    queryKey: ["availability", "active"],
    queryFn: () => callApi(api.GET("/api/availability/active")),
  });

  if (!data?.memberId) return null;

  let unansweredCount = 0;
  for (const req of data.items) {
    const answeredDates = new Set(req.myResponses.map((r) => r.match_date));
    const fixtureDates = new Set(req.fixtures.map((f) => f.match_date));
    for (const d of fixtureDates) {
      if (!answeredDates.has(d)) unansweredCount++;
    }
  }

  if (unansweredCount === 0) return null;

  return (
    <a
      href={
        (import.meta.env.VITE_MATCHDAY_URL as string | undefined) ??
        "https://matchday.percymain.org"
      }
      className="block w-full rounded border border-blue-300 bg-blue-50 p-3 text-sm text-blue-800 transition-colors hover:bg-blue-100"
    >
      You have <strong>{unansweredCount}</strong> availability{" "}
      {unansweredCount === 1 ? "date" : "dates"} to respond to.{" "}
      <span className="underline">Respond now</span>
    </a>
  );
}

/**
 * Renders the Scout dashboard link only when the current user has the
 * admin or official role (resolved server-side via /scout/access).
 * Hidden for everyone else (cosmetic gate; the real boundary is the
 * API's requireScoutAccess preHandler).
 */
function ScoutLink() {
  const { data: access } = useQuery({
    queryKey: ["scout", "access"],
    queryFn: () => callApi(api.GET("/api/scout/access")),
    staleTime: 5 * 60 * 1000,
  });

  if (!access?.allowed) return null;

  return (
    <Link
      className="rounded border border-stone-800 px-3 py-1.5 text-sm text-stone-900 hover:bg-stone-200"
      to="/scout"
    >
      ImbuzAI
    </Link>
  );
}
