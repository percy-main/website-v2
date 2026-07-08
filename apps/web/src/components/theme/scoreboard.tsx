import type { paths } from "@/lib/api.gen.js";
import { formatInTimeZone } from "date-fns-tz";
import { Link } from "react-router";

type RecentGamesResponse =
  paths["/api/games/recent"]["get"]["responses"]["200"]["content"]["application/json"];
export type RecentGameItem = RecentGamesResponse["items"][number];
type RecentGameInnings = RecentGameItem["innings"][number];

const OUTCOME_STAMPS: Record<
  NonNullable<RecentGameItem["outcome"]>,
  { label: string; tone: "won" | "lost" | "neutral" }
> = {
  W: { label: "Won", tone: "won" },
  L: { label: "Lost", tone: "lost" },
  D: { label: "Draw", tone: "neutral" },
  T: { label: "Tied", tone: "neutral" },
  A: { label: "Aban", tone: "neutral" },
  C: { label: "Canc", tone: "neutral" },
  N: { label: "N/R", tone: "neutral" },
};

/**
 * Play Cricket disambiguates club names with a county suffix
 * ("Civil Service CC, Northumberland") - too long for a scorecard line.
 * Also bind the trailing token (usually "CC") to the word before it so a
 * wrap never orphans it.
 */
function displayClubName(name: string): string {
  const short = name.split(",")[0].trim();
  return short.replace(/ (\S+)$/, "\u00A0$1");
}

function formatScore(innings: RecentGameInnings): string {
  const wickets = innings.allOut ? "" : `/${String(innings.wickets)}`;
  const declared = innings.declared ? "d" : "";
  return `${String(innings.runs)}${wickets}${declared}`;
}

interface SideRow {
  key: string;
  clubName: string;
  meta: string;
  batting: boolean;
  innings: RecentGameInnings | null;
}

/**
 * A card shows one row per side, in batting order where known. Sides that
 * haven't batted follow the innings rows; on a live card the last innings
 * row is the side currently batting.
 */
function buildRows(item: RecentGameItem): SideRow[] {
  const us = {
    key: "us",
    teamId: item.team.id,
    clubName: "Percy Main",
    meta: [item.team.name, item.home ? "Home" : "Away"]
      .filter(Boolean)
      .join(" · "),
  };
  const them = {
    key: "them",
    teamId: item.opposition.team.id,
    clubName: displayClubName(item.opposition.club.name),
    meta: item.opposition.team.name,
  };
  // Batting order wins where innings exist; otherwise home side reads first,
  // as a scorecard would list it.
  const sides = item.home ? [us, them] : [them, us];

  const sideByTeamId = new Map(sides.map((side) => [side.teamId, side]));

  const rows: SideRow[] = [];
  for (const [index, innings] of item.innings.entries()) {
    const side = sideByTeamId.get(innings.teamBattingId);
    const batting = item.status === "live" && index === item.innings.length - 1;
    rows.push({
      key: side?.key ?? `innings-${String(index)}`,
      clubName: side ? side.clubName : displayClubName(innings.teamName),
      meta: side
        ? [side.meta, batting ? "Batting" : ""].filter(Boolean).join(" · ")
        : "",
      batting,
      innings,
    });
  }
  for (const side of sides) {
    if (!rows.some((row) => row.key === side.key)) {
      rows.push({
        key: side.key,
        clubName: side.clubName,
        meta: side.meta,
        batting: false,
        innings: null,
      });
    }
  }
  return rows;
}

function ScoreboardCard({ item }: { item: RecentGameItem }) {
  const live = item.status === "live";
  const stamp = item.outcome ? OUTCOME_STAMPS[item.outcome] : null;
  const competition = item.competition.name || item.league.name;

  return (
    <Link
      to={`/calendar/game/${item.id}`}
      className={`fc-sbcard${live ? "fc-sbcard--live" : ""}`}
    >
      <div className="fc-sb-eyebrow">
        {live ? (
          <span className="fc-sb-lamp">
            <i aria-hidden="true" />
            Live
          </span>
        ) : (
          <span>
            {item.when
              ? formatInTimeZone(
                  new Date(item.when),
                  "Europe/London",
                  "EEE d MMM",
                )
              : ""}
          </span>
        )}
        <span>{competition}</span>
      </div>

      {buildRows(item).map((row) => (
        <div key={row.key} className="fc-sb-line">
          <div className="fc-sb-teamwrap">
            <div className="fc-sb-team">
              {row.batting && <span className="fc-sb-bat" aria-hidden="true" />}
              {row.clubName}
            </div>
            {row.meta && <div className="fc-sb-teammeta">{row.meta}</div>}
          </div>
          <div className="fc-sb-scorewrap">
            {row.innings ? (
              <>
                <div className="fc-sb-score">{formatScore(row.innings)}</div>
                {row.innings.overs && (
                  <div className="fc-sb-overs">{row.innings.overs} overs</div>
                )}
              </>
            ) : (
              <div className="fc-sb-noscore">{live ? "Yet to bat" : "–"}</div>
            )}
          </div>
        </div>
      ))}

      <div className="fc-sb-foot">
        {live ? (
          <>
            <span className="fc-sb-livenote">{item.note ?? "In play"}</span>
            <span className="fc-sb-follow">Follow &rarr;</span>
          </>
        ) : (
          <>
            <span>{item.note}</span>
            {stamp && (
              <span className={`fc-sb-stamp fc-sb-stamp--${stamp.tone}`}>
                {stamp.label}
              </span>
            )}
          </>
        )}
      </div>
    </Link>
  );
}

/** The homepage scoreboard card grid. Purely presentational - the section
 * wrapper (Plate + mast + query) lives with the page that hosts it. */
export function ScoreboardStrip({ items }: { items: RecentGameItem[] }) {
  return (
    <div className="fc-sb-grid">
      {items.map((item) => (
        <ScoreboardCard key={item.id} item={item} />
      ))}
    </div>
  );
}
