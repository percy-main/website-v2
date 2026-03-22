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
  topBatter: { name: string; runs: number; notOut: boolean } | null;
  topBowler: { name: string; wickets: number; runs: number } | null;
  sponsor: { name: string; logoUrl: string | null } | null;
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
  const hasScore = data.innings.length > 0;
  const hasOutcome = outcome.text !== "";

  // Build score text
  let scoreText = "";
  if (data.innings.length >= 2) {
    scoreText = `${formatInningsScore(data.innings[0])}  –  ${formatInningsScore(data.innings[1])}`;
  } else if (data.innings.length === 1) {
    scoreText = formatInningsScore(data.innings[0]);
  }

  // Key performers — single line
  const performers: string[] = [];
  if (data.topBatter) {
    const notOutStar = data.topBatter.notOut ? "*" : "";
    performers.push(
      `${data.topBatter.name} ${data.topBatter.runs}${notOutStar}`,
    );
  }
  if (data.topBowler) {
    performers.push(
      `${data.topBowler.name} ${data.topBowler.wickets}/${data.topBowler.runs}`,
    );
  }

  // Layout: 3 layers max, score is the focal point
  // Layer 1: Teams (top) — 64px
  // Layer 2: Score (centre, hero) — 84px
  // Layer 3: Result + performers (bottom) — 36px

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- Top accent bar -->
  <rect x="0" y="0" width="${W}" height="8" fill="${GOLD}"/>

  <!-- Team names — Layer 1 -->
  <text x="${W / 2}" y="100" text-anchor="middle" font-family="${FONT}" font-size="52" font-weight="bold" fill="${WHITE}">
    ${escapeXml(data.teamName)}
  </text>
  <text x="${W / 2}" y="148" text-anchor="middle" font-family="${FONT}" font-size="28" fill="rgba(255,255,255,0.5)">
    vs
  </text>
  <text x="${W / 2}" y="200" text-anchor="middle" font-family="${FONT}" font-size="52" font-weight="bold" fill="${WHITE}">
    ${escapeXml(data.oppositionName)}
  </text>

  ${
    hasOutcome
      ? `<!-- Outcome badge -->
  <rect x="${W / 2 - 70}" y="230" width="140" height="44" rx="22" fill="${outcome.color}"/>
  <text x="${W / 2}" y="260" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="bold" fill="${WHITE}">
    ${outcome.text}
  </text>`
      : ""
  }

  ${
    hasScore
      ? `<!-- Score — Layer 2 (focal point) -->
  <text x="${W / 2}" y="${hasOutcome ? 370 : 320}" text-anchor="middle" font-family="${FONT}" font-size="96" font-weight="bold" fill="${WHITE}">
    ${escapeXml(scoreText)}
  </text>`
      : ""
  }

  ${
    performers.length > 0
      ? `<!-- Key performers -->
  <text x="${W / 2}" y="${hasOutcome ? 475 : 450}" text-anchor="middle" font-family="${FONT}" font-size="36" fill="#F0D078">
    ${escapeXml(performers.join("   •   "))}
  </text>`
      : ""
  }

  <!-- Footer bar -->
  <rect x="0" y="${H - 80}" width="${W}" height="80" fill="rgba(0,0,0,0.35)"/>
  ${
    data.sponsor
      ? `<text x="${W / 2}" y="${H - 45}" text-anchor="middle" font-family="${FONT}" font-size="24" fill="rgba(255,255,255,0.6)">
    Sponsored by
  </text>
  <text x="${W / 2}" y="${H - 15}" text-anchor="middle" font-family="${FONT}" font-size="32" font-weight="bold" fill="${WHITE}">
    ${escapeXml(data.sponsor.name)}
  </text>`
      : `<text x="${W / 2}" y="${H - 28}" text-anchor="middle" font-family="${FONT}" font-size="32" font-weight="bold" fill="${WHITE}">
    Percy Main Cricket &amp; Sports Club
  </text>`
  }
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

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// --- Service factory ---

export function generateOgImage(
  db: Kysely<DB>,
  api: PlayCricketApiClient,
  siteId: string,
) {
  return async (matchId: string): Promise<Buffer | null> => {
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

    // Get result and sponsorship from DB in parallel
    const [dbResult, sponsorship] = await Promise.all([
      db
        .selectFrom("match_result")
        .where("match_id", "=", matchId)
        .selectAll()
        .executeTakeFirst(),
      db
        .selectFrom("game_sponsorship")
        .where("game_id", "=", matchId)
        .where("approved", "=", true)
        .where("paid_at", "is not", null)
        .select(["display_name", "sponsor_name", "sponsor_logo_url"])
        .executeTakeFirst(),
    ]);

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
          const howOut = (best.how_out ?? "").toLowerCase().trim();
          topBatter = {
            name: best.batsman_name,
            runs: parseInt(best.runs),
            notOut: howOut === "not out" || howOut === "",
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
      sponsor: sponsorship
        ? {
            name: sponsorship.display_name ?? sponsorship.sponsor_name,
            logoUrl: sponsorship.sponsor_logo_url,
          }
        : null,
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

    const layers: sharp.OverlayOptions[] = [
      { input: svgBuffer, blend: "over" },
    ];

    // Composite sponsor logo into the footer if available
    if (matchData.sponsor?.logoUrl) {
      const logoBuffer = await fetchImage(matchData.sponsor.logoUrl);
      if (logoBuffer) {
        const resizedLogo = await sharp(logoBuffer)
          .resize({ height: 50, fit: "inside" })
          .toBuffer();
        layers.push({
          input: resizedLogo,
          gravity: "southeast",
          blend: "over",
        });
      }
    }

    const pngBuffer = await sharp(heroBackground)
      .composite(layers)
      .png()
      .toBuffer();

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
