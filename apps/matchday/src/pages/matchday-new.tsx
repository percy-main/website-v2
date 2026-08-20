import { StickyActionBar } from "@/components/shell/sticky-action-bar.js";
import { Button } from "@/components/ui/button.js";
import { api, callApi } from "@/lib/api-client.js";
import { canManageMatchday, useSession } from "@/lib/auth-client.js";
import { cn } from "@/lib/utils.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

/**
 * Create a custom matchday — a fixture that doesn't exist on
 * Play-Cricket (friendlies, club games). Posts to the same
 * POST /api/matchday the fixture-detail "Pick team" button uses, just
 * without a playCricketMatchId, then drops straight into the squad
 * editor. Home/away and start time are captured here because there's
 * no upstream record to derive them from — they feed the team sheet
 * and the team-news image.
 */

const COMPETITION_TYPES = ["Friendly", "League", "Cup"] as const;

export default function MatchdayNew() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const canCreate = canManageMatchday(session?.user);

  const [teamId, setTeamId] = useState("");
  // Local calendar date, not toISOString(): UTC-based slicing defaults
  // the form to yesterday when opened between midnight and 1am BST.
  const [matchDate, setMatchDate] = useState(() => {
    const now = new Date();
    return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [opposition, setOpposition] = useState("");
  const [isHome, setIsHome] = useState(true);
  const [matchTime, setMatchTime] = useState("");
  const [competitionType, setCompetitionType] = useState<string>("Friendly");

  const teams = useQuery({
    queryKey: ["matchday", "teams"],
    queryFn: () => callApi(api.GET("/api/matchday/teams")),
    enabled: canCreate,
  });

  const create = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/matchday", {
          body: {
            teamId,
            matchDate,
            opposition: opposition.trim(),
            isHome,
            ...(matchTime ? { matchTime } : {}),
            ...(competitionType ? { competitionType } : {}),
          },
        }),
      ),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["matchday"] });
      void qc.invalidateQueries({ queryKey: ["games"] });
      void navigate(`/matchday/${data.id}/edit`);
    },
  });

  // Session resolves before any queries fire; only block once we know
  // the member definitely lacks matchday access.
  if (session && !canCreate) {
    return (
      <div className="p-6 text-center">
        <p className="text-text-secondary text-sm">
          You need matchday access to create a match.
        </p>
        <Button asChild tone="outline" className="mt-3">
          <Link to="/fixtures">Back to fixtures</Link>
        </Button>
      </div>
    );
  }

  const teamList = teams.data ?? [];
  const canSubmit =
    !!teamId &&
    !!matchDate &&
    opposition.trim().length > 0 &&
    !create.isPending;

  return (
    <div className="mx-auto w-full max-w-2xl pb-24">
      <header className="border-border flex items-center gap-3 border-b p-3">
        <Link
          to="/fixtures"
          className="text-text-secondary hover:bg-surface-raised grid size-9 place-items-center rounded-md"
          aria-label="Back"
        >
          <ArrowLeftIcon className="size-5" />
        </Link>
        <strong className="text-sm">New match</strong>
      </header>

      <div className="space-y-4 px-4 py-6">
        <section>
          <p className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
            Team
          </p>
          {teams.isPending && (
            <div className="border-border bg-surface-raised text-text-secondary mt-2 rounded-2xl border p-4 text-sm">
              Loading teams…
            </div>
          )}
          {!teams.isPending && teamList.length === 0 && (
            <div className="border-border bg-surface-raised text-text-secondary mt-2 rounded-2xl border p-4 text-sm">
              No teams available. You need to be an official for at least one
              team.
            </div>
          )}
          {teamList.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {teamList.map((t) => (
                <Chip
                  key={t.id}
                  label={t.name ?? "Unnamed team"}
                  selected={teamId === t.id}
                  onClick={() => setTeamId(t.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="grid grid-cols-2 gap-3">
          <Field
            label="Date"
            type="date"
            value={matchDate}
            onChange={setMatchDate}
          />
          <Field
            label="Start time (optional)"
            type="time"
            value={matchTime}
            onChange={setMatchTime}
          />
        </section>

        <section>
          <label className="flex flex-col gap-1">
            <span className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
              Opposition
            </span>
            <input
              type="text"
              value={opposition}
              onChange={(e) => setOpposition(e.currentTarget.value)}
              placeholder="e.g. Tynemouth CC"
              className="border-border bg-surface h-11 rounded-lg border px-3 text-sm"
            />
          </label>
        </section>

        <section>
          <p className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
            Venue
          </p>
          <div className="mt-2 flex gap-2">
            <Chip
              label="Home"
              selected={isHome}
              onClick={() => setIsHome(true)}
            />
            <Chip
              label="Away"
              selected={!isHome}
              onClick={() => setIsHome(false)}
            />
          </div>
        </section>

        <section>
          <p className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
            Competition
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {COMPETITION_TYPES.map((c) => (
              <Chip
                key={c}
                label={c}
                selected={competitionType === c}
                // Tapping the selected chip clears it — competition
                // type is optional and drives which match-fee rule
                // applies, so "none" must stay reachable.
                onClick={() =>
                  setCompetitionType(competitionType === c ? "" : c)
                }
              />
            ))}
          </div>
        </section>

        {create.isError && (
          <p className="text-danger text-sm">
            {create.error.message || "Couldn't create the match. Try again."}
          </p>
        )}
      </div>

      <StickyActionBar outerClassName="md:border-t-0">
        <Button asChild tone="outline">
          <Link to="/fixtures">Cancel</Link>
        </Button>
        <Button
          tone="primary"
          disabled={!canSubmit}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Creating…" : "Create & pick squad"}
        </Button>
      </StickyActionBar>
    </div>
  );
}

function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium",
        selected
          ? "border-navy bg-navy text-white"
          : "border-border bg-surface text-text-secondary",
      )}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-text-secondary text-[11px] font-semibold tracking-[0.06em] uppercase">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="border-border bg-surface h-11 rounded-lg border px-3 text-sm"
      />
    </label>
  );
}
