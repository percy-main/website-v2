import { StatusPill } from "@/components/primitives/status-pill.js";
import { Button } from "@/components/ui/button.js";
import { CrownIcon, GloveIcon } from "@/features/icons/cricket-icons.js";
import { fmtDate } from "@/features/format.js";
import { api, callApi } from "@/lib/api-client.js";
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

interface PublicMatchday {
  id: string;
  matchDate: string;
  startTime?: string | null;
  teamName?: string | null;
  opposition?: string | null;
  ground?: string | null;
  competition?: string | null;
  away: boolean;
  status: "pending" | "confirmed" | "finished";
  result?: string | null;
  scoreSummary?: string | null;
  squad: PublicPlayer[];
  dropouts: PublicPlayer[];
}
interface PublicPlayer {
  matchdayPlayerId: string;
  memberId: string | null;
  isCaptain: boolean;
  isKeeper: boolean;
  isGuest: boolean;
  displayName: string;
  note?: string | null;
}

export default function TeamSheet() {
  const { matchdayId } = useParams();
  const { data: session } = useSession();
  const myUserId = session?.user.id;
  const { data, isLoading, isError } = useQuery({
    queryKey: ["matchday", matchdayId, "public"],
    // The path placeholder uses {matchId} on the existing endpoint —
    // the new /api/matchday/:id/public reuses that same placeholder.
    queryFn: () => {
      // Path is added in this branch but the OpenAPI spec hasn't been
      // regenerated yet — typed access lands after pnpm openapi:generate.
      const get = api.GET as unknown as (
        path: string,
        opts: { params: { path: Record<string, string> } },
      ) => Promise<{ data?: unknown; error?: unknown; response: Response }>;
      return callApi(
        get("/api/matchday/{matchId}/public", {
          params: { path: { matchId: matchdayId ?? "" } },
        }),
      );
    },
    enabled: !!matchdayId,
  });
  const [showDropouts, setShowDropouts] = useState(false);
  const [copied, setCopied] = useState(false);

  if (isLoading) return <Skel />;
  if (isError || !data) return <ErrState />;
  const md = data as unknown as PublicMatchday;

  return (
    <div className="mx-auto w-full max-w-2xl pb-12">
      <div className="flex items-center justify-between p-3">
        <Link
          to="/fixtures"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary"
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
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-raised"
          aria-label="Copy team-sheet link"
        >
          <ShareIcon className="size-4" />
          {copied ? "Copied" : "Share"}
        </button>
      </div>
      <header className="px-4 pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
          {fmtDate(md.matchDate, "EEEE · d MMMM")}
          {md.startTime ? ` · ${md.startTime}` : ""}
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-[-0.01em]">
          {md.teamName ?? "Percy Main"} vs {md.opposition ?? "TBC"}
        </h1>
        <div className="mt-1 flex items-center gap-2 text-xs text-text-secondary">
          <span>{[md.away ? "Away" : "Home", md.ground, md.competition].filter(Boolean).join(" · ")}</span>
        </div>
        {md.status === "finished" && md.scoreSummary && (
          <div className="mt-3 inline-block rounded-md bg-surface-raised px-3 py-1.5 text-sm font-semibold">
            {md.scoreSummary}
          </div>
        )}
      </header>

      <h2 className="bg-surface-raised px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
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
        className="flex w-full items-center justify-between bg-surface-raised px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary"
      >
        <span>Drop-outs · {md.dropouts.length}</span>
        <span aria-hidden>{showDropouts ? "▴" : "▾"}</span>
      </button>
      {showDropouts &&
        md.dropouts.map((p) => (
          <div
            key={p.matchdayPlayerId}
            className="grid grid-cols-[28px_1fr_auto] items-center gap-3 border-t border-border-light bg-surface px-4 py-2.5"
          >
            <span />
            <div>
              <div className="text-sm font-medium">{p.displayName}</div>
              {p.note && (
                <div className="text-xs text-text-secondary">"{p.note}"</div>
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
        "grid grid-cols-[28px_1fr_auto] items-center gap-3 border-t border-border-light px-4 py-2.5",
        isYou && "bg-info-bg/40",
      )}
    >
      <div className="text-center text-xs font-medium text-text-secondary">
        {rank}
      </div>
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
        {p.isCaptain && (
          <CrownIcon
            className="size-3.5 text-warning"
            aria-label="Captain"
          />
        )}
        {p.isKeeper && (
          <GloveIcon
            className="size-3.5 text-info"
            aria-label="Wicketkeeper"
          />
        )}
        <span className="truncate">
          {p.displayName}
          {p.isCaptain && " (c)"}
          {p.isKeeper && " (wk)"}
        </span>
        {isYou && (
          <span className="rounded bg-navy px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            You
          </span>
        )}
        {p.isGuest && (
          <span className="text-xs italic text-text-secondary">guest</span>
        )}
      </div>
    </div>
  );
}

function Skel() {
  return (
    <div className="p-4 space-y-2">
      <div className="h-6 w-2/3 rounded-md bg-border" />
      <div className="h-4 w-1/2 rounded-md bg-border-light" />
      <div className="mt-3 h-10 rounded-md bg-border" />
      <div className="h-10 rounded-md bg-border" />
      <div className="h-10 rounded-md bg-border" />
    </div>
  );
}

function ErrState() {
  return (
    <div className="p-6 text-center">
      <p className="text-sm text-text-secondary">
        Couldn't load this team sheet. You may need to be signed in or named
        in the squad.
      </p>
      <Button asChild tone="outline" className="mt-3">
        <Link to="/fixtures">Back to fixtures</Link>
      </Button>
    </div>
  );
}
