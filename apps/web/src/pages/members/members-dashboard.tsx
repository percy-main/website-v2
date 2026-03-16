import { ChangePassword } from "@/components/members/change-password";
import { Charges } from "@/components/members/charges";
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
import { useSession } from "@/lib/auth-client";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";

const TABS = ["membership", "details", "security", "payments"] as const;
type Tab = (typeof TABS)[number];

function isValidTab(value: string | null): value is Tab {
  return TABS.includes(value as Tab);
}

export function Component() {
  const { data: session } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = isValidTab(tabParam) ? tabParam : "membership";

  const onTabChange = (value: string) => {
    setSearchParams(value === "membership" ? {} : { tab: value }, {
      replace: true,
    });
  };

  if (!session) return null;

  const { user } = session;

  return (
    <div className="container mx-auto px-4 py-8">
      <OnboardingModal onGoToDetails={() => onTabChange("details")} />
      <div className="flex flex-col items-start justify-stretch gap-4">
        <div className="flex w-full flex-row items-start justify-between">
          <h1>Members Area</h1>
          <div className="flex flex-row flex-wrap gap-4">
            {user.role === "admin" && (
              <Link
                className="rounded border border-gray-800 px-4 py-2 text-sm text-gray-900 hover:bg-gray-200"
                to="/admin"
              >
                Admin Panel
              </Link>
            )}

            {(user.role === "junior_manager" || user.role === "admin") && (
              <Link
                className="rounded border border-gray-800 px-4 py-2 text-sm text-gray-900 hover:bg-gray-200"
                to="/junior-manager"
              >
                Junior Teams
              </Link>
            )}

            <Link
              className="rounded border border-gray-800 px-4 py-2 text-sm text-gray-900 hover:bg-gray-200"
              to="/members/fantasy"
            >
              Fantasy Cricket
            </Link>
            <Link
              className="rounded border border-gray-800 px-4 py-2 text-sm text-gray-900 hover:bg-gray-200"
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
          </TabsList>
          <IncompleteDetailsBanner hidden={tab === "details"} />
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
              <Charges />
              <Subscriptions />
            </div>
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
    () => !!localStorage.getItem(ONBOARDING_DISMISSED_KEY),
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
            membership, we recommend completing your details — but you can do
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
