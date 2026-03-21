import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HERO_IMAGE_PATH = join(__dirname, "..", "..", "assets", "pitch.png");

// --- Types ---

interface OgMatchData {
  teamName: string;
  oppositionName: string;
  matchDate: string;
  outcome: string | null;
  resultDescription: string;
  competitionName: string;
  innings: Array<{
    teamName: string;
    runs: number;
    wickets: number;
    allOut: boolean;
    declared: boolean;
  }>;
  topBatter: { name: string; runs: number } | null;
  topBowler: { name: string; wickets: number; runs: number } | null;
}

// --- SVG Template ---

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatMatchDate(dateStr: string): string {
  // dateStr is DD/MM/YYYY
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
  const [dd, mm, yyyy] = dateStr.split("/");
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatInningsScore(innings: OgMatchData["innings"][number]): string {
  const wicketStr = innings.allOut ? "" : `/${innings.wickets}`;
  const declStr = innings.declared ? "d" : "";
  return `${innings.runs}${wicketStr}${declStr}`;
}

function getOutcomeLabel(outcome: string | null): {
  text: string;
  color: string;
} {
  switch (outcome) {
    case "W":
      return { text: "WON", color: "#22C55E" };
    case "L":
      return { text: "LOST", color: "#EF4444" };
    case "D":
      return { text: "DRAW", color: "#F59E0B" };
    case "T":
      return { text: "TIED", color: "#F59E0B" };
    case "A":
      return { text: "ABANDONED", color: "#6B7280" };
    case "C":
      return { text: "CANCELLED", color: "#6B7280" };
    case "N":
      return { text: "NO RESULT", color: "#6B7280" };
    default:
      return { text: "", color: "#6B7280" };
  }
}

function buildSvg(data: OgMatchData): string {
  const W = 1200;
  const H = 630;
  const GOLD = "#D4A843";
  const WHITE = "#FFFFFF";
  const FONT = "Arial, Helvetica, sans-serif";

  const outcome = getOutcomeLabel(data.outcome);
  const dateFormatted = formatMatchDate(data.matchDate);

  // Layout: vertically centered content with tighter spacing
  // Header block: competition + date (top)
  // Middle block: teams + score + outcome (centered)
  // Footer block: result desc + performers + branding (bottom)

  const hasScore = data.innings.length > 0;
  const hasOutcome = outcome.text !== "";

  // Build score text
  let scoreText = "";
  if (data.innings.length >= 2) {
    scoreText = `${formatInningsScore(data.innings[0])}  –  ${formatInningsScore(data.innings[1])}`;
  } else if (data.innings.length === 1) {
    scoreText = formatInningsScore(data.innings[0]);
  }

  // Key performers
  const performers: string[] = [];
  if (data.topBatter) {
    performers.push(`${data.topBatter.name} ${data.topBatter.runs}*`);
  }
  if (data.topBowler) {
    performers.push(
      `${data.topBowler.name} ${data.topBowler.wickets}/${data.topBowler.runs}`,
    );
  }

  // Calculate vertical positions — center the content block
  const headerY = 50;
  const teamStartY = 150;
  const vsY = teamStartY + 40;
  const oppY = vsY + 40;
  const outcomeY = oppY + 20;
  const scoreY = hasOutcome ? outcomeY + 90 : oppY + 55;
  const resultDescY = scoreY + (hasScore ? 40 : 0);
  const performersY = resultDescY + (data.resultDescription ? 30 : 0);
  const footerY = H - 55;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- Top accent bar -->
  <rect x="0" y="0" width="${W}" height="6" fill="${GOLD}"/>

  <!-- Competition + Date header -->
  <text x="${W / 2}" y="${headerY}" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="bold" fill="${GOLD}" letter-spacing="2">
    ${escapeXml(data.competitionName.toUpperCase())}
  </text>
  <text x="${W / 2}" y="${headerY + 25}" text-anchor="middle" font-family="${FONT}" font-size="16" fill="rgba(255,255,255,0.6)">
    ${escapeXml(dateFormatted)}
  </text>

  <!-- Divider -->
  <line x1="200" y1="${headerY + 45}" x2="${W - 200}" y2="${headerY + 45}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>

  <!-- Team names -->
  <text x="${W / 2}" y="${teamStartY}" text-anchor="middle" font-family="${FONT}" font-size="36" font-weight="bold" fill="${WHITE}">
    ${escapeXml(data.teamName)}
  </text>
  <text x="${W / 2}" y="${vsY}" text-anchor="middle" font-family="${FONT}" font-size="18" fill="rgba(255,255,255,0.4)">
    vs
  </text>
  <text x="${W / 2}" y="${oppY}" text-anchor="middle" font-family="${FONT}" font-size="36" font-weight="bold" fill="${WHITE}">
    ${escapeXml(data.oppositionName)}
  </text>

  ${
    hasOutcome
      ? `<!-- Outcome badge -->
  <rect x="${W / 2 - 55}" y="${outcomeY}" width="110" height="30" rx="15" fill="${outcome.color}"/>
  <text x="${W / 2}" y="${outcomeY + 21}" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="bold" fill="${WHITE}">
    ${outcome.text}
  </text>`
      : ""
  }

  ${
    hasScore
      ? `<!-- Score -->
  <text x="${W / 2}" y="${scoreY}" text-anchor="middle" font-family="${FONT}" font-size="64" font-weight="bold" fill="${WHITE}">
    ${escapeXml(scoreText)}
  </text>`
      : ""
  }

  ${
    data.resultDescription
      ? `<!-- Result description -->
  <text x="${W / 2}" y="${resultDescY}" text-anchor="middle" font-family="${FONT}" font-size="20" fill="rgba(255,255,255,0.6)">
    ${escapeXml(data.resultDescription)}
  </text>`
      : ""
  }

  ${
    performers.length > 0
      ? `<!-- Key performers -->
  <text x="${W / 2}" y="${performersY}" text-anchor="middle" font-family="${FONT}" font-size="20" fill="rgba(255,255,255,0.8)">
    ${escapeXml(performers.join("   •   "))}
  </text>`
      : ""
  }

  <!-- Bottom divider -->
  <line x1="200" y1="${footerY - 25}" x2="${W - 200}" y2="${footerY - 25}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>

  <!-- Footer -->
  <text x="${W / 2}" y="${footerY}" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="bold" fill="${WHITE}">
    Percy Main Cricket &amp; Sports Club
  </text>
  <text x="${W / 2}" y="${footerY + 22}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="rgba(255,255,255,0.4)">
    percymain.org
  </text>
</svg>`;
}

// --- Helpers to extract key performers ---

function resolveOutcome(
  result: string,
  resultAppliedTo: string,
  ourTeamId: string,
  resultDescription: string,
): string | null {
  if (!result || result === "") return null;

  const desc = resultDescription.toLowerCase();
  if (desc.includes("abandoned")) return "A";
  if (desc.includes("cancel")) return "C";
  if (desc.includes("tied") || result === "T") return "T";
  if (desc.includes("draw") || result === "D") return "D";
  if (desc.includes("no result")) return "N";

  if (result === "W") {
    if (!resultAppliedTo) return null;
    return resultAppliedTo === ourTeamId ? "W" : "L";
  }

  return null;
}

// --- Service factory ---

export function generateOgImage(
  db: Kysely<DB>,
  api: PlayCricketApiClient,
  siteId: string,
) {
  const cache = new Map<string, Buffer>();

  return async (matchId: string): Promise<Buffer | null> => {
    // Check cache first
    const cached = cache.get(matchId);
    if (cached) return cached;

    // Fetch match detail from Play Cricket API
    const matchDetail = await api.getMatchDetail(matchId).catch(() => null);
    if (!matchDetail) return null;

    const detail = matchDetail.match_details[0];
    if (!detail) return null;

    // Determine which team is ours
    const isHome = detail.home_club_id === siteId;
    const ourTeamId = isHome ? detail.home_team_id : detail.away_team_id;
    const teamName = isHome
      ? `${detail.home_club_name} ${detail.home_team_name}`
      : `${detail.away_club_name} ${detail.away_team_name}`;
    const oppositionName = isHome
      ? `${detail.away_club_name} ${detail.away_team_name}`
      : `${detail.home_club_name} ${detail.home_team_name}`;

    // Get result from DB
    const dbResult = await db
      .selectFrom("match_result")
      .where("match_id", "=", matchId)
      .selectAll()
      .executeTakeFirst();

    const outcome = dbResult
      ? resolveOutcome(
          dbResult.result,
          dbResult.result_applied_to,
          ourTeamId,
          dbResult.result_description,
        )
      : null;

    // Build innings data
    const innings = detail.innings.map((inn) => ({
      teamName: inn.team_batting_name,
      runs: parseInt(inn.runs) || 0,
      wickets: parseInt(inn.wickets) || 0,
      allOut: (parseInt(inn.wickets) || 0) >= 10,
      declared: inn.declared ?? false,
    }));

    // Find top batter (from our team's batting innings)
    let topBatter: OgMatchData["topBatter"] = null;
    for (const inn of detail.innings) {
      if (inn.team_batting_id === ourTeamId && inn.bat.length > 0) {
        const sorted = [...inn.bat].sort(
          (a, b) => (parseInt(b.runs) || 0) - (parseInt(a.runs) || 0),
        );
        const best = sorted[0];
        if (best && parseInt(best.runs) > 0) {
          topBatter = {
            name: best.batsman_name,
            runs: parseInt(best.runs),
          };
        }
      }
    }

    // Find top bowler (from our team's bowling — in the opponent's batting innings)
    let topBowler: OgMatchData["topBowler"] = null;
    for (const inn of detail.innings) {
      if (inn.team_batting_id !== ourTeamId && inn.bowl.length > 0) {
        const sorted = [...inn.bowl].sort((a, b) => {
          const wicketDiff =
            (parseInt(b.wickets) || 0) - (parseInt(a.wickets) || 0);
          if (wicketDiff !== 0) return wicketDiff;
          return (parseInt(a.runs) || 0) - (parseInt(b.runs) || 0);
        });
        const best = sorted[0];
        if (best && parseInt(best.wickets) > 0) {
          topBowler = {
            name: best.bowler_name,
            wickets: parseInt(best.wickets),
            runs: parseInt(best.runs),
          };
        }
      }
    }

    // Determine competition name
    const competitionName =
      detail.competition_type || detail.match_type || "Cricket";

    const matchData: OgMatchData = {
      teamName,
      oppositionName,
      matchDate: detail.match_date || "",
      outcome,
      resultDescription: detail.result_description,
      competitionName,
      innings,
      topBatter,
      topBowler,
    };

    // Generate SVG and convert to PNG
    const svg = buildSvg(matchData);

    // Build the image: hero background with dark overlay, then SVG on top
    const heroBackground = await sharp(HERO_IMAGE_PATH)
      .resize(1200, 630, { fit: "cover" })
      .modulate({ brightness: 0.3 })
      .tint({ r: 27, g: 61, b: 47 }) // #1B3D2F club green
      .toBuffer();

    const svgBuffer = await sharp(Buffer.from(svg))
      .resize(1200, 630)
      .png()
      .toBuffer();

    const pngBuffer = await sharp(heroBackground)
      .composite([{ input: svgBuffer, blend: "over" }])
      .png()
      .toBuffer();

    // Cache the result
    cache.set(matchId, pngBuffer);

    return pngBuffer;
  };
}

// --- HTML page for OG meta tags ---

export function buildOgHtmlPage(
  baseUrl: string,
  apiBaseUrl: string,
  matchId: string,
  title: string,
): string {
  const imageUrl = `${apiBaseUrl}/api/og/game/${encodeURIComponent(matchId)}`;
  const canonicalUrl = `${baseUrl}/calendar/game/${encodeURIComponent(matchId)}`;
  const redirectUrl = `${canonicalUrl}?og=1`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeXml(title)}</title>
  <meta property="og:title" content="${escapeXml(title)}">
  <meta property="og:image" content="${escapeXml(imageUrl)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeXml(canonicalUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeXml(title)}">
  <meta name="twitter:image" content="${escapeXml(imageUrl)}">
  <meta http-equiv="refresh" content="0;url=${escapeXml(redirectUrl)}">
</head>
<body>
  <p>Redirecting to <a href="${escapeXml(redirectUrl)}">${escapeXml(canonicalUrl)}</a></p>
</body>
</html>`;
}

// Exported for testing
export { buildSvg, type OgMatchData };
