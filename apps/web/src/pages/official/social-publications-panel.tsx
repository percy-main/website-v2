import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, callApi } from "@/lib/api-client";
import type { paths } from "@/lib/api.gen.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";

type Publications =
  paths["/api/matchday/{matchId}/social-publications"]["get"]["responses"][200]["content"]["application/json"];
type PublicationRow = Publications["items"][number];
type Platform = "facebook" | "instagram";

const PLATFORM_LABELS: Record<Platform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
};

const STATE_COLORS: Record<string, string> = {
  claimed: "bg-yellow-100 text-yellow-800",
  posted: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

const STUCK_THRESHOLD_MS = 10 * 60 * 1000;

function isStuckClaim(row: PublicationRow): boolean {
  if (row.state !== "claimed") return false;
  const claimedAt = new Date(row.claimed_at).getTime();
  return Date.now() - claimedAt > STUCK_THRESHOLD_MS;
}

function externalUrl(platform: string, id: string): string | null {
  if (platform === "facebook") return `https://facebook.com/${id}`;
  if (platform === "instagram") return `https://instagram.com/p/${id}`;
  return null;
}

export function SocialPublicationsPanel({
  matchdayId,
  isHome,
  matchTime,
}: {
  matchdayId: string;
  isHome: boolean;
  matchTime: string | null;
}) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["social-publications", matchdayId],
    queryFn: () =>
      callApi(
        api.GET("/api/matchday/{matchId}/social-publications", {
          params: { path: { matchId: matchdayId } },
        }),
      ),
    refetchInterval: (q) => {
      const items = q.state.data?.items ?? [];
      return items.some((row) => row.state === "claimed") ? 5000 : false;
    },
  });

  const retryMutation = useMutation({
    mutationFn: (platform: Platform) =>
      callApi(
        api.POST(
          "/api/matchday/{matchId}/social-publications/{platform}/retry",
          {
            params: { path: { matchId: matchdayId, platform } },
            body: { isHome, matchTime },
          },
        ),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["social-publications", matchdayId],
      }),
  });

  const [reconciling, setReconciling] = useState<Platform | null>(null);

  const items = query.data?.items ?? [];

  if (query.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Social Posting</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (query.isError) {
    return null;
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Social Posting</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">
            No posting attempts yet. Posts are kicked off when a team is
            confirmed.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Social Posting</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {items.map((row) => {
            const platform = row.platform as Platform;
            const stuck = isStuckClaim(row);
            const url =
              row.state === "posted" && row.external_post_id
                ? externalUrl(row.platform, row.external_post_id)
                : null;

            return (
              <div
                key={row.id}
                className="flex items-center justify-between rounded border border-gray-200 px-3 py-2"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">
                      {PLATFORM_LABELS[platform] ?? row.platform}
                    </p>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        STATE_COLORS[row.state] ?? ""
                      }`}
                    >
                      {stuck ? "needs reconciliation" : row.state}
                    </span>
                    {row.caption_source === "fallback" && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                        fallback caption
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {row.state === "posted" && row.posted_at && (
                      <span>
                        Posted{" "}
                        {format(new Date(row.posted_at), "dd/MM/yyyy HH:mm")}
                      </span>
                    )}
                    {row.state === "failed" && row.last_error && (
                      <span className="text-red-600">{row.last_error}</span>
                    )}
                    {row.attempt_count > 1 && (
                      <span className="ml-2">
                        (attempts: {row.attempt_count})
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 underline"
                    >
                      View
                    </a>
                  )}
                  {row.state === "failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retryMutation.isPending}
                      onClick={() => retryMutation.mutate(platform)}
                    >
                      Retry
                    </Button>
                  )}
                  {stuck && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setReconciling(platform)}
                    >
                      Reconcile
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {retryMutation.isError && (
            <p className="text-sm text-red-600">Retry failed.</p>
          )}
        </CardContent>
      </Card>

      <ReconcileDialog
        matchdayId={matchdayId}
        platform={reconciling}
        onClose={() => setReconciling(null)}
      />
    </>
  );
}

function ReconcileDialog({
  matchdayId,
  platform,
  onClose,
}: {
  matchdayId: string;
  platform: Platform | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [externalPostId, setExternalPostId] = useState("");

  const mutation = useMutation({
    mutationFn: (
      body:
        | { outcome: "posted"; externalPostId: string }
        | { outcome: "failed" },
    ) => {
      if (!platform) throw new Error("No platform selected");
      return callApi(
        api.POST(
          "/api/matchday/{matchId}/social-publications/{platform}/reconcile",
          {
            params: { path: { matchId: matchdayId, platform } },
            body,
          },
        ),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["social-publications", matchdayId],
      });
      setExternalPostId("");
      onClose();
    },
  });

  const open = platform !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Reconcile {platform ? (PLATFORM_LABELS[platform] ?? platform) : ""}{" "}
            publication
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <p>
            This post is stuck in <code>claimed</code>. Confirm whether it
            actually landed on{" "}
            {platform ? PLATFORM_LABELS[platform] : "the platform"}.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              External post ID (only if the post did land)
            </label>
            <Input
              placeholder="e.g. 17890… or pfbid0…"
              value={externalPostId}
              onChange={(e) => setExternalPostId(e.target.value)}
            />
          </div>
          {mutation.isError && (
            <p className="text-sm text-red-600">
              Reconciliation failed. Try again or check the logs.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => mutation.mutate({ outcome: "failed" })}
            disabled={mutation.isPending}
          >
            Mark as failed
          </Button>
          <Button
            onClick={() =>
              mutation.mutate({
                outcome: "posted",
                externalPostId: externalPostId.trim(),
              })
            }
            disabled={mutation.isPending || !externalPostId.trim()}
          >
            Mark as posted
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
