import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { TeamNewsData } from "./service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HERO_IMAGE_PATH = join(__dirname, "..", "..", "assets", "pitch.png");
const CLUB_LOGO_PATH = join(__dirname, "..", "..", "assets", "club_logo.png");
const CLUB_SPONSOR_PATH = join(
  __dirname,
  "..",
  "..",
  "assets",
  "club_sponsor.png",
);

const SIZE = 1080;
const WHITE = "#FFFFFF";
const FONT = "Arial, Helvetica, sans-serif";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatShortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  const initial = parts[0][0];
  const surname = parts[parts.length - 1];
  return `${initial} ${surname}`;
}

function formatMatchDate(isoDate: string): string {
  const date = new Date(isoDate + "T12:00:00");
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long" });
  const day = date.getDate();
  const month = date.toLocaleDateString("en-GB", { month: "long" });
  const year = date.getFullYear();

  const suffixes = ["th", "st", "nd", "rd"];
  const suffix = day >= 11 && day <= 13 ? "th" : (suffixes[day % 10] ?? "th");

  return `${weekday} ${day}${suffix} ${month} ${year}`;
}

function buildSvg(data: TeamNewsData): string {
  const titleText = `${escapeXml(data.teamName)} V  ${escapeXml(data.opposition)}`;
  const venueText = data.isHome
    ? "HOME"
    : `AWAY @ ${escapeXml(data.opposition).split(" ")[0].toUpperCase()}`;
  const dateText = escapeXml(formatMatchDate(data.matchDate)).toUpperCase();
  const timeText = data.matchTime ? ` - ${escapeXml(data.matchTime)}` : "";

  // Player list
  const maxPlayers = Math.min(data.players.length, 12);
  const playerStartY = 240;
  const playerLineHeight = 58;

  const playerLines = data.players.slice(0, maxPlayers).map((p, i) => {
    const name = escapeXml(formatShortName(p.playerName));
    const y = playerStartY + i * playerLineHeight;
    const sponsorSuffix = p.sponsorName
      ? ` <tspan font-size="16" fill="rgba(255,255,255,0.5)" font-style="italic">Sponsored by ${escapeXml(p.sponsorName)}</tspan>`
      : "";

    return `  <text x="140" y="${y}" font-family="${FONT}" font-size="38" font-weight="bold" fill="${WHITE}">${name}${sponsorSuffix}</text>`;
  });

  // "TEAM NEWS" — large outlined text, rotated vertically on the left
  // Positioned far enough right that rotation doesn't clip it
  const watermarkX = 85;
  const watermarkY = SIZE / 2 + 50;
  const watermark = `
  <text x="${watermarkX}" y="${watermarkY}" text-anchor="middle"
    font-family="${FONT}" font-size="110" font-weight="bold"
    fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2.5"
    transform="rotate(-90, ${watermarkX}, ${watermarkY})">TEAM NEWS</text>`;

  // Match sponsor text (bottom area, left-aligned)
  const matchSponsorSvg = data.matchSponsor
    ? `<text x="140" y="${SIZE - 100}" font-family="${FONT}" font-size="16" fill="rgba(255,255,255,0.5)">Match sponsored by</text>
  <text x="140" y="${SIZE - 72}" font-family="${FONT}" font-size="26" font-weight="bold" fill="${WHITE}">${escapeXml(data.matchSponsor.name)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <!-- Header bar background -->
  <rect x="0" y="0" width="${SIZE}" height="6" fill="#D4A843"/>

  <!-- Title: team vs opposition -->
  <text x="${SIZE / 2}" y="80" text-anchor="middle" font-family="${FONT}" font-size="40" font-weight="bold" fill="${WHITE}" letter-spacing="2">
    ${titleText}
  </text>

  <!-- Date and time -->
  <text x="${SIZE / 2}" y="125" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="bold" fill="#F0D078" letter-spacing="1">
    ${dateText}${timeText}
  </text>
  <!-- Venue -->
  <text x="${SIZE / 2}" y="160" text-anchor="middle" font-family="${FONT}" font-size="22" fill="rgba(255,255,255,0.6)">${venueText}</text>

  <!-- Horizontal rule -->
  <rect x="120" y="180" width="${SIZE - 240}" height="2" fill="rgba(255,255,255,0.2)"/>

  ${watermark}

  <!-- Player list -->
${playerLines.join("\n")}

  <!-- Bottom rule -->
  <rect x="120" y="${SIZE - 140}" width="${SIZE - 240}" height="2" fill="rgba(255,255,255,0.2)"/>

  ${matchSponsorSvg}

  <!-- Footer -->
  <text x="${SIZE / 2}" y="${SIZE - 15}" text-anchor="middle" font-family="${FONT}" font-size="16" fill="rgba(255,255,255,0.3)">percymain.org</text>
</svg>`;
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

export async function generateTeamNewsImage(
  data: TeamNewsData,
): Promise<Buffer> {
  // Background: pitch photo — bright, only lightly darkened
  const heroBackground = await sharp(HERO_IMAGE_PATH)
    .resize(SIZE, SIZE, { fit: "cover" })
    .modulate({ brightness: 0.65, saturation: 1.1 })
    .toBuffer();

  // Semi-transparent dark overlay on the left half for text readability
  const overlaySvg = `<svg width="${SIZE}" height="${SIZE}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#000" stop-opacity="0.7"/>
        <stop offset="0.55" stop-color="#000" stop-opacity="0.45"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.1"/>
      </linearGradient>
    </defs>
    <rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/>
    <!-- Top bar solid for header readability -->
    <rect width="${SIZE}" height="175" fill="rgba(0,0,0,0.55)"/>
  </svg>`;
  const overlayBuffer = await sharp(Buffer.from(overlaySvg))
    .resize(SIZE, SIZE)
    .png()
    .toBuffer();

  // Render the text SVG
  const svg = buildSvg(data);
  const svgBuffer = await sharp(Buffer.from(svg))
    .resize(SIZE, SIZE)
    .png()
    .toBuffer();

  const layers: sharp.OverlayOptions[] = [
    { input: overlayBuffer, blend: "over" },
    { input: svgBuffer, blend: "over" },
  ];

  // Club logo — top-left, prominent
  try {
    const clubLogo = await sharp(CLUB_LOGO_PATH)
      .resize({ height: 130, fit: "inside" })
      .toBuffer();
    layers.push({
      input: clubLogo,
      top: 25,
      left: 25,
      blend: "over",
    });
  } catch {
    // Skip if not found
  }

  // Club sponsor (Crossling) — bottom-right area
  try {
    const sponsorLogo = await sharp(CLUB_SPONSOR_PATH)
      .resize({ height: 55, fit: "inside" })
      .toBuffer();
    const meta = await sharp(sponsorLogo).metadata();
    const logoWidth = meta.width ?? 100;
    layers.push({
      input: sponsorLogo,
      top: SIZE - 65,
      left: SIZE - logoWidth - 15,
      blend: "over",
    });
  } catch {
    // Skip if not found
  }

  // Match sponsor logo — right side, above club sponsor
  if (data.matchSponsor?.logoUrl) {
    const logoBuffer = await fetchImage(data.matchSponsor.logoUrl);
    if (logoBuffer) {
      const resizedLogo = await sharp(logoBuffer)
        .resize({ height: 55, fit: "inside" })
        .toBuffer();
      const logoMeta = await sharp(resizedLogo).metadata();
      const logoWidth = logoMeta.width ?? 55;
      layers.push({
        input: resizedLogo,
        top: SIZE - 135,
        left: SIZE - logoWidth - 20,
        blend: "over",
      });
    }
  }

  const pngBuffer = await sharp(heroBackground)
    .composite(layers)
    .png()
    .toBuffer();

  return pngBuffer;
}
