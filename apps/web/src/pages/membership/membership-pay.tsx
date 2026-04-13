import { RadioButtons } from "@/components/radio-buttons";
import { buttonVariants } from "@/components/ui/button";
import { useDocumentMeta } from "@/hooks/use-document-meta";
import { api, callApi } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";

type MembershipType =
  | "senior_player"
  | "social"
  | "senior_women_player"
  | "concessionary";

function PayMembershipInner() {
  const [searchParams] = useSearchParams();
  const emailParam = searchParams.get("email");
  const email = emailParam ? decodeURIComponent(emailParam) : undefined;

  const [membership, setMembership] = useState<MembershipType>();
  const [schedule, setSchedule] = useState<"annually" | "monthly">();

  const { data: options, isLoading } = useQuery({
    queryKey: ["membership-prices"],
    queryFn: () => callApi(api.GET("/api/membership/prices")),
    staleTime: 5 * 60_000,
  });

  if (isLoading || !options) {
    return (
      <div className="text-center text-sm text-gray-500">Loading prices...</div>
    );
  }

  const price = membership ? options[membership] : null;
  const isWomen = membership === "senior_women_player";

  const selectedPrice =
    price && schedule
      ? schedule === "annually"
        ? price.annually
        : price.monthly
      : null;

  const purchaseParams = new URLSearchParams();
  if (selectedPrice) {
    purchaseParams.set(
      "metadata",
      JSON.stringify({ type: "membership", membership }),
    );
    if (email) {
      purchaseParams.set("email", email);
    }
    if (selectedPrice.mode === "subscription") {
      purchaseParams.set("type", "subscription");
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h4>Choose Your Membership</h4>

      <div className="mt-8">
        <section className="mb-12">
          <h5>Your Membership</h5>
          <p>
            Choose the category of membership for which you would like to apply.
          </p>
          <RadioButtons
            id="membership"
            onChange={(val: MembershipType) => {
              setMembership(val);
              setSchedule(undefined);
            }}
            value={membership}
            options={[
              {
                title: "Senior Player",
                description: "For all senior playing members.",
                value: "senior_player" as const,
              },
              {
                title: "Social",
                description: "For supporters and friends of the club.",
                value: "social" as const,
              },
              {
                title: "Student / Concessionary",
                description: "For students and concessionary members.",
                value: "concessionary" as const,
              },
              {
                title: "Women's Player",
                description: "For senior women playing members.",
                value: "senior_women_player" as const,
              },
            ]}
          />
        </section>
      </div>

      {price && membership && (
        <>
          <section className="mb-12">
            <h5>
              You can choose to pay{" "}
              {isWomen ? "for the season or monthly." : "annually or monthly."}
            </h5>
            <RadioButtons
              id="schedule"
              onChange={setSchedule}
              value={schedule}
              options={[
                {
                  title: isWomen ? "Season" : "Annually",
                  description: isWomen
                    ? `${price.annually.formattedPrice}/season`
                    : `${price.annually.formattedPrice}/annum`,
                  value: "annually" as const,
                },
                {
                  title: "Monthly",
                  description: `${price.monthly.formattedPrice}/month`,
                  value: "monthly" as const,
                },
              ]}
            />
          </section>
          {selectedPrice && (
            <section className="mb-12">
              <Link
                to={`/purchase/${selectedPrice.id}?${purchaseParams.toString()}`}
                className={buttonVariants()}
              >
                Pay Online
              </Link>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export function Component() {
  useDocumentMeta("Choose Membership");
  return <PayMembershipInner />;
}
