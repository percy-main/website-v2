import type { paths } from "@/lib/api.gen.js";
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";

// Head data for prerendered game and calendar-month pages: pure string
// assembly from the game detail payload, kept separate from build-head
// so it unit-tests without the document pipeline. The prerenderer Lambda
// calls gameHeadData/monthHeadData and feeds the result into buildHead;
// the metadata round-trips through gameHeadMetadataSchema, which is what
// build-head's SportsEvent JSON-LD consumes.

type GameData =
  paths["/api/games/{matchId}"]["get"]["responses"]["200"]["content"]["application/json"];

export const gameHeadMetadataSchema = z.object({
  when: z.string().nullish(),
  homeTeam: z.string(),
  awayTeam: z.string(),
  locationName: z.string().nullish(),
});

export type GameHeadMetadata = z.infer<typeof gameHeadMetadataSchema>;

const OUTCOME_LABELS: Record<string, string> = {
  W: "Won",
  L: "Lost",
  D: "Draw",
  T: "Tied",
  A: "Abandoned",
  C: "Cancelled",
  N: "No result",
};

const TZ = "Europe/London";

export interface GameHeadData {
  title: string;
  description: string;
  metadata: GameHeadMetadata;
}

export function gameHeadData(game: GameData): GameHeadData {
  const opposition =
    `${game.opposition.club.name} ${game.opposition.team.name}`.trim();
  const venue = game.home ? "H" : "A";
  const dateLabel = game.when
    ? formatInTimeZone(new Date(game.when), TZ, "d MMMM yyyy")
    : null;

  const title = `${game.team.name} vs ${opposition} (${venue})${
    dateLabel ? ` - ${dateLabel}` : ""
  }`;

  const where = game.home ? "at home" : "away";
  const outcomeLabel = game.outcome ? OUTCOME_LABELS[game.outcome] : undefined;
  let description: string;
  if (outcomeLabel) {
    const score = game.scoreDescription ? ` (${game.scoreDescription})` : "";
    description = `${outcomeLabel}${score} - ${game.team.name} ${where} against ${opposition}${
      dateLabel ? ` on ${dateLabel}` : ""
    }. Full scorecard and match details.`;
  } else {
    const timeLabel = game.when
      ? formatInTimeZone(
          new Date(game.when),
          TZ,
          "h:mmaaa 'on' EEEE d MMMM yyyy",
        )
      : null;
    const sponsor = game.sponsor
      ? ` Match sponsored by ${game.sponsor.name}.`
      : "";
    description = `${game.team.name} play ${opposition} ${where}${
      timeLabel ? `, ${timeLabel}` : ""
    }.${sponsor} Fixture details and directions.`;
  }

  const ourName = `Percy Main ${game.team.name}`;
  return {
    title,
    description,
    metadata: {
      when: game.when ?? null,
      homeTeam: game.home ? ourName : opposition,
      awayTeam: game.home ? opposition : ourName,
      locationName: game.location?.name ?? game.groundName ?? null,
    },
  };
}

export function monthHeadData(
  year: number,
  monthName: string,
): { title: string; description: string } {
  const monthLabel = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  return {
    title: `Fixtures & Events - ${monthLabel} ${year.toString()}`,
    description: `Percy Main Community Sports Club cricket fixtures, results and club events for ${monthLabel} ${year.toString()}.`,
  };
}
