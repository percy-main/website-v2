import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, callApi } from "@/lib/api-client";
import { REQUEST_STATUS_LABELS } from "@percy-main/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

/**
 * Members area: surface the caller's relief request(s) at the top of
 * the Payments tab when any exist, or a discreet "ask for relief" link
 * when none do. The form page itself lives at /members/financial-relief.
 *
 * Owning both states here keeps the dashboard tab dumb and stops a
 * confusing "you already have an open request, but here's a button to
 * make another one" appearing for members mid-review.
 */
export function FinancialReliefStatus() {
  const { data, isLoading } = useQuery({
    queryKey: ["financial-relief", "me"],
    queryFn: () => callApi(api.GET("/api/financial-relief/me")),
  });

  if (isLoading) return null;

  const requests = data?.requests ?? [];

  if (requests.length === 0) {
    return (
      <p className="text-xs text-stone-600">
        Struggling with fees?{" "}
        <Link
          className="text-blue-900 underline"
          to="/members/financial-relief"
        >
          Ask the club about financial relief.
        </Link>
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your financial relief</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {requests.map((r) => (
          <div key={r.id} className="flex flex-col gap-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.memberName ?? "—"}</span>
              <Badge variant="secondary">
                {REQUEST_STATUS_LABELS[r.status]}
              </Badge>
            </div>
            {r.memberFacingNote ? (
              <p className="text-stone-700">{r.memberFacingNote}</p>
            ) : null}
            {r.activeGrant ? (
              <p className="text-stone-700">
                Support is in place
                {r.activeGrant.coversMatchFees ? " for match donations" : ""}
                {r.activeGrant.coversMembership
                  ? " for membership donations"
                  : ""}
                .
              </p>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
