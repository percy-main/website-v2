import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, callApi } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { useNavigate } from "react-router";

const AVAILABILITY_NAG_DISMISSED_KEY = "pmcsc_availability_nag_dismissed";

/**
 * Modal that prompts members to respond to outstanding availability requests.
 * Currently disabled — re-enable by adding <AvailabilityNagModal /> to the
 * members dashboard when ready.
 */
export function AvailabilityNagModal() {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(
    () => !!sessionStorage.getItem(AVAILABILITY_NAG_DISMISSED_KEY),
  );

  const query = useQuery({
    queryKey: ["availability", "active"],
    queryFn: () => callApi(api.GET("/api/availability/active")),
    enabled: !dismissed,
  });

  const dismiss = () => {
    sessionStorage.setItem(AVAILABILITY_NAG_DISMISSED_KEY, "1");
    setDismissed(true);
  };

  if (dismissed || !query.data?.memberId) return null;

  // Find requests with unanswered dates
  const unansweredDates: string[] = [];
  for (const req of query.data.items) {
    const answeredDates = new Set(req.myResponses.map((r) => r.match_date));
    const fixtureDates = [
      ...new Set(req.fixtures.map((f) => f.match_date)),
    ].sort();
    for (const d of fixtureDates) {
      if (!answeredDates.has(d)) {
        unansweredDates.push(d);
      }
    }
  }

  if (unansweredDates.length === 0) return null;

  return (
    <Dialog open onOpenChange={(v) => !v && dismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Availability needed</DialogTitle>
          <DialogDescription>
            Officials are waiting on your availability for{" "}
            {unansweredDates.length === 1 ? (
              <strong>
                {format(new Date(unansweredDates[0]), "EEEE d MMMM")}
              </strong>
            ) : (
              <>
                <strong>{unansweredDates.length} dates</strong> including{" "}
                <strong>
                  {format(new Date(unansweredDates[0]), "EEEE d MMMM")}
                </strong>
              </>
            )}
            . Please let them know if you're available.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={dismiss}>
            Later
          </Button>
          <Button
            onClick={() => {
              dismiss();
              void navigate("/matchday");
            }}
          >
            Respond Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
