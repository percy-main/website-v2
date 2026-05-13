import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import { fmtDate } from "@/features/format.js";
import { CrownIcon, GloveIcon } from "@/features/icons/cricket-icons.js";
import { api, callApi, type ApiResponse } from "@/lib/api-client.js";
import { useSession } from "@/lib/auth-client.js";
import { cn } from "@/lib/utils.js";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ShareIcon } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

/**
 * Phase 2 team sheet view.
 *
 * Reads /api/matchday/:id/public — the new reduced-shape endpoint that
 * any signed-in member can hit (the official-gated /matchday/:id stays as
 * the source of truth for write operations + expense/charge data).
 *
 * Highlights the current user's row with a YOU badge; crown for captain,
 * gloves for keeper. Drop-outs collapsed by default to keep the squad
 * focal.
 */

type PublicMatchday = ApiResponse<"/api/matchday/{matchId}/public">;
type PublicPlayer = PublicMatchday["squad"][number];

export default function TeamSheet() {
  const { matchdayId } = useParams();
  const { data: session } = useSession();
  const myUserId = session?.user.id;
  const {
    data: md,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["matchday", matchdayId, "public"],
    queryFn: () =>
      callApi(
        api.GET("/api/matchday/{matchId}/public", {
          params: { path: { matchId: matchdayId ?? "" } },
        }),
      ),
    enabled: !!matchdayId,
  });
  const [showDropouts, setShowDropouts] = useState(false);
  const [copied, setCopied] = useState(false);

  if (isLoading) return <Skel />;
  if (isError || !md) return <ErrState />;

  return (
    <div className="mx-auto w-full max-w-2xl pb-12">
      <div className="flex items-center justify-between p-3">
        <Link
          to="/fixtures"
          className="text-text-secondary inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeftIcon className="size-4" /> Back
        </Link>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(window.location.href);
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 2200);
          }}
          className="text-text-secondary hover:bg-surface-raised inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium"
          aria-label="Copy team-sheet link"
        >
          <ShareIcon className="size-4" />
          {copied ? "Copied" : "Share"}
        </button>
      </div>
      <header className="px-4 pb-3">
        <p className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
          {fmtDate(md.matchDate, "EEEE · d MMMM")}
          {md.startTime ? ` · ${md.startTime}` : ""}
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-[-0.01em]">
          {md.teamName ?? "Percy Main"} vs {md.opposition ?? "TBC"}
        </h1>
        <div className="text-text-secondary mt-1 flex items-center gap-2 text-xs">
          <span>
            {[md.away ? "Away" : "Home", md.ground, md.competition]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {md.status === "finished" && md.scoreSummary && (
          <div className="bg-surface-raised mt-3 inline-block rounded-md px-3 py-1.5 text-sm font-semibold">
            {md.scoreSummary}
          </div>
        )}
      </header>

      <h2 className="bg-surface-raised text-text-secondary px-4 py-1.5 text-[11px] font-semibold tracking-[0.06em] uppercase">
        Squad · {md.squad.length}
      </h2>
      {md.squad.map((p, i) => (
        <PlayerRow
          key={p.matchdayPlayerId}
          p={p}
          rank={i + 1}
          isYou={!!myUserId && p.memberId === myUserId}
        />
      ))}

      <button
        type="button"
        onClick={() => setShowDropouts((v) => !v)}
        className="bg-surface-raised text-text-secondary flex w-full items-center justify-between px-4 py-2.5 text-[11px] font-semibold tracking-[0.06em] uppercase"
      >
        <span>Drop-outs · {md.dropouts.length}</span>
        <span aria-hidden>{showDropouts ? "▴" : "▾"}</span>
      </button>
      {showDropouts &&
        md.dropouts.map((p) => (
          <div
            key={p.matchdayPlayerId}
            className="border-border-light bg-surface grid grid-cols-[28px_1fr_auto] items-center gap-3 border-t px-4 py-2.5"
          >
            <span />
            <div>
              <div className="text-sm font-medium">{p.displayName}</div>
              {p.note && (
                <div className="text-text-secondary text-xs">"{p.note}"</div>
              )}
            </div>
            <StatusPill tone="danger">Dropped out</StatusPill>
          </div>
        ))}
    </div>
  );
}

function PlayerRow({
  p,
  rank,
  isYou,
}: {
  p: PublicPlayer;
  rank: number;
  isYou: boolean;
}) {
  return (
    <div
      className={cn(
        "border-border-light grid grid-cols-[28px_1fr_auto] items-center gap-3 border-t px-4 py-2.5",
        isYou && "bg-info-bg/40",
      )}
    >
      <div className="text-text-secondary text-center text-xs font-medium">
        {rank}
      </div>
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
        {p.isCaptain && (
          <CrownIcon className="text-warning size-3.5" aria-label="Captain" />
        )}
        {p.isKeeper && (
          <GloveIcon className="text-info size-3.5" aria-label="Wicketkeeper" />
        )}
        <span className="truncate">
          {p.displayName}
          {p.isCaptain && " (c)"}
          {p.isKeeper && " (wk)"}
        </span>
        {isYou && (
          <span className="bg-navy rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
            You
          </span>
        )}
        {p.isGuest && (
          <span className="text-text-secondary text-xs italic">guest</span>
        )}
      </div>
    </div>
  );
}

function Skel() {
  return (
    <div className="space-y-2 p-4">
      <div className="bg-border h-6 w-2/3 rounded-md" />
      <div className="bg-border-light h-4 w-1/2 rounded-md" />
      <div className="bg-border mt-3 h-10 rounded-md" />
      <div className="bg-border h-10 rounded-md" />
      <div className="bg-border h-10 rounded-md" />
    </div>
  );
}

function ErrState() {
  return (
    <div className="p-6 text-center">
      <p className="text-text-secondary text-sm">
        Couldn't load this team sheet. You may need to be signed in or named in
        the squad.
      </p>
      <Button asChild tone="outline" className="mt-3">
        <Link to="/fixtures">Back to fixtures</Link>
      </Button>
    </div>
  );
}
