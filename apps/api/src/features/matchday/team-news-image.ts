import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import sharp from "sharp";
import type { TeamNewsData } from "./service.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "..", "assets");
const HERO_IMAGE_PATH = join(ASSETS, "pitch.jpg");
const CLUB_LOGO_PATH = join(ASSETS, "club_logo.png");
const CLUB_SPONSOR_PATH = join(ASSETS, "club_sponsor.png");
const DISPLAY_FONT_PATH = join(ASSETS, "Anton-Regular.ttf");

// Parse the display font at module load. librsvg (used by sharp) doesn't
// support @font-face with data URIs, so we convert each text string to an
// SVG path at render time using the parsed font.
const displayFont = opentype.parse(readFileSync(DISPLAY_FONT_PATH).buffer);

const SIZE = 1080;
const WHITE = "#FFFFFF";
const RED = "#C94434";
const TITLE_BLUE = "#1E3A8C";
const SUBTITLE_RED = "#8A2E23";

// Red panel shape: slightly trapezoidal, narrower at top, wider at bottom
const PANEL_TOP_Y = 165;
const PANEL_TOP_RIGHT_X = 470;
const PANEL_BOTTOM_RIGHT_X = 640;

const NAME_SUFFIXES = new Set(["jnr", "jr", "snr", "sr", "ii", "iii", "iv"]);

function capitalise(word: string): string {
  if (word.length === 0) return word;
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

function formatShortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;

  const initial = parts[0][0].toUpperCase();

  const lastPart = parts[parts.length - 1];
  if (parts.length >= 3 && NAME_SUFFIXES.has(lastPart.toLowerCase())) {
    const surname = capitalise(parts[parts.length - 2]);
    const suffix = capitalise(lastPart);
    return `${initial} ${surname} ${suffix}`;
  }

  const surname = capitalise(lastPart);
  return `${initial} ${surname}`;
}

function formatMatchDate(isoDate: string): string {
  const date = new Date(isoDate + "T12:00:00");
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long" });
  const day = date.getDate();
  const month = date.toLocaleDateString("en-GB", { month: "long" });

  const suffixes = ["th", "st", "nd", "rd"];
  const suffix = day >= 11 && day <= 13 ? "th" : (suffixes[day % 10] ?? "th");

  return `${weekday} ${day}${suffix} ${month}`;
}

function shortTeamLabel(teamName: string): string {
  return teamName.replace(/^Percy Main\s*/i, "").trim() || teamName;
}

function venueLabel(data: TeamNewsData): string {
  if (data.isHome) return "PERCY MAIN";
  const first = data.opposition.split(" ")[0];
  return first.toUpperCase();
}

// Shrink the font size until `text` fits within `maxWidth`. Returns the
// preferred size if it already fits, otherwise steps down by 2pt until it
// does (stopping at `minSize`).
function fitFontSize(
  text: string,
  preferredSize: number,
  maxWidth: number,
  minSize: number,
): number {
  let size = preferredSize;
  while (size > minSize && displayFont.getAdvanceWidth(text, size) > maxWidth) {
    size -= 2;
  }
  return size;
}

interface TextOpts {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  anchor?: "start" | "middle" | "end";
  transform?: string;
}

// Render a text string as an SVG <path> using the loaded display font.
// Baseline is at y. x is relative to the anchor.
function textPath(
  text: string,
  x: number,
  y: number,
  fontSize: number,
  opts: TextOpts = {},
): { markup: string; width: number } {
  const anchor = opts.anchor ?? "start";
  const width = displayFont.getAdvanceWidth(text, fontSize);
  let renderX = x;
  if (anchor === "middle") renderX = x - width / 2;
  else if (anchor === "end") renderX = x - width;

  const path = displayFont.getPath(text, renderX, y, fontSize);
  const d = path.toPathData(2);

  const attrs: string[] = [`d="${d}"`];
  attrs.push(`fill="${opts.fill ?? "none"}"`);
  if (opts.stroke) attrs.push(`stroke="${opts.stroke}"`);
  if (opts.strokeWidth) attrs.push(`stroke-width="${opts.strokeWidth}"`);
  if (opts.opacity !== undefined) attrs.push(`opacity="${opts.opacity}"`);
  if (opts.transform) attrs.push(`transform="${opts.transform}"`);

  return { markup: `<path ${attrs.join(" ")}/>`, width };
}

function buildSvg(data: TeamNewsData): string {
  const teamShort = shortTeamLabel(data.teamName).toUpperCase();
  const opposition = data.opposition.toUpperCase();
  const homeAway = data.isHome ? "H" : "A";
  const title = `${teamShort} V ${opposition} (${homeAway})`;

  const dateText = formatMatchDate(data.matchDate).toUpperCase();
  const timeText = data.matchTime ? ` • ${data.matchTime}` : "";
  const subtitle = `${dateText}${timeText} @ ${venueLabel(data)}`;

  // Header text — centered in the area to the right of the club logo.
  // Shrink the font if the title is too long to fit (long opposition names).
  const headerLeftPadding = 170; // right edge of the logo + gap
  const headerRightPadding = 30;
  const headerCenterX = (headerLeftPadding + (SIZE - headerRightPadding)) / 2;
  const maxTitleWidth = SIZE - headerLeftPadding - headerRightPadding;
  const titleFontSize = fitFontSize(title, 58, maxTitleWidth, 30);
  const subtitleFontSize = fitFontSize(subtitle, 36, maxTitleWidth, 20);
  const titlePath = textPath(title, headerCenterX, 82, titleFontSize, {
    fill: TITLE_BLUE,
    anchor: "middle",
  });
  const subtitlePath = textPath(
    subtitle,
    headerCenterX,
    138,
    subtitleFontSize,
    { fill: SUBTITLE_RED, anchor: "middle" },
  );

  const maxPlayers = Math.min(data.players.length, 11);
  const playerStartY = 240;
  const playerFontSize = 50;
  const sponsorFontSize = 18;
  const sponsorX = 186;

  const selectedPlayers = data.players.slice(0, maxPlayers);
  const sponsorCount = selectedPlayers.filter((p) => p.sponsorName).length;

  // Spread players to use the full vertical space. Sponsored players get a
  // bit more room so the sponsor line doesn't crowd the next name. If that
  // would overflow the panel, shrink the base line proportionally.
  const sponsorExtra = 26;
  const bottomPadding = 25;
  const availableHeight = SIZE - playerStartY - bottomPadding;
  const preferredBase = 70;
  const totalAtPreferred =
    selectedPlayers.length * preferredBase + sponsorCount * sponsorExtra;
  const baseLineHeight =
    totalAtPreferred > availableHeight
      ? (availableHeight - sponsorCount * sponsorExtra) / selectedPlayers.length
      : preferredBase;

  const playerPaths: string[] = [];
  let baseline = playerStartY;
  for (const p of selectedPlayers) {
    const name = formatShortName(p.playerName);
    const roleSuffix = `${p.isCaptain ? " *" : ""}${p.isWicketkeeper ? " †" : ""}`;
    const lineText = `${name}${roleSuffix}`;
    const line = textPath(lineText, 180, baseline, playerFontSize, {
      fill: WHITE,
    });
    playerPaths.push(line.markup);

    if (p.sponsorName) {
      // Sponsor sits just below the player name. Overflow past the red
      // panel's right edge is fine — long sponsor names are acceptable.
      const sponsorText = `Sponsored by ${p.sponsorName}`;
      const sponsor = textPath(
        sponsorText,
        sponsorX,
        baseline + 32,
        sponsorFontSize,
        { fill: WHITE, opacity: 0.7 },
      );
      playerPaths.push(sponsor.markup);
      baseline += baseLineHeight + sponsorExtra;
    } else {
      baseline += baseLineHeight;
    }
  }

  // "TEAM NEWS" — outlined, italic, rotated vertically down the left of the
  // red panel. Positioned so the top sits clear of the header and the letters
  // don't clip the left edge or the player list.
  const watermarkFontSize = 125;
  const watermarkText = "TEAM NEWS";
  const watermarkWidth = displayFont.getAdvanceWidth(
    watermarkText,
    watermarkFontSize,
  );
  const watermarkTopY = 280;
  const watermarkX = 135;
  const watermark = textPath(watermarkText, 0, 0, watermarkFontSize, {
    stroke: WHITE,
    strokeWidth: 3,
    transform: `translate(${watermarkX}, ${watermarkTopY + watermarkWidth}) rotate(-90) skewX(-12)`,
  });

  // Red diagonal panel
  const panel = `<polygon points="0,${PANEL_TOP_Y} ${PANEL_TOP_RIGHT_X},${PANEL_TOP_Y} ${PANEL_BOTTOM_RIGHT_X},${SIZE} 0,${SIZE}" fill="${RED}" fill-opacity="0.92"/>`;

  // Translucent header band so title is readable over any photo
  const header = `<rect x="0" y="0" width="${SIZE}" height="${PANEL_TOP_Y}" fill="rgba(255,255,255,0.82)"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  ${header}
  ${panel}
  ${titlePath.markup}
  ${subtitlePath.markup}
  ${watermark.markup}
${playerPaths.join("\n")}
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
  // Resize the photo to the canvas width preserving aspect so the entire
  // image is shown without cropping. Pad the top with a colour sampled from
  // the top edge of the photo so the extended band blends into the sky.
  const resized = await sharp(HERO_IMAGE_PATH)
    .resize(SIZE, null, { fit: "inside" })
    .toBuffer();
  const resizedMeta = await sharp(resized).metadata();
  const resizedH = resizedMeta.height ?? SIZE;

  const topRowPixel = await sharp(resized)
    .extract({ left: 0, top: 0, width: SIZE, height: 1 })
    .resize(1, 1, { kernel: "cubic" })
    .raw()
    .toBuffer();

  const heroBackground =
    resizedH >= SIZE
      ? resized
      : await sharp(resized)
          .extend({
            top: SIZE - resizedH,
            bottom: 0,
            background: {
              r: topRowPixel[0],
              g: topRowPixel[1],
              b: topRowPixel[2],
            },
          })
          .toBuffer();

  const svg = buildSvg(data);
  const svgBuffer = await sharp(Buffer.from(svg))
    .resize(SIZE, SIZE)
    .png()
    .toBuffer();

  const layers: sharp.OverlayOptions[] = [{ input: svgBuffer, blend: "over" }];

  // Club logo — top-left, sits inside the header band
  try {
    const clubLogo = await sharp(CLUB_LOGO_PATH)
      .resize({ height: 140, fit: "inside" })
      .toBuffer();
    layers.push({
      input: clubLogo,
      top: 15,
      left: 20,
      blend: "over",
    });
  } catch {
    // Skip if not found
  }

  // Sponsors stacked on the right side
  const sponsorSlots: Array<{ buffer: Buffer; top: number; left: number }> = [];
  let nextTop = SIZE - 120;

  try {
    const sponsorLogo = await sharp(CLUB_SPONSOR_PATH)
      .resize({ height: 80, fit: "inside" })
      .toBuffer();
    const meta = await sharp(sponsorLogo).metadata();
    const logoWidth = meta.width ?? 120;
    sponsorSlots.push({
      buffer: sponsorLogo,
      top: nextTop,
      left: SIZE - logoWidth - 40,
    });
    nextTop -= 110;
  } catch {
    // Skip if not found
  }

  if (data.matchSponsor?.logoUrl) {
    const logoBuffer = await fetchImage(data.matchSponsor.logoUrl);
    if (logoBuffer) {
      const resizedLogo = await sharp(logoBuffer)
        .resize({ height: 80, fit: "inside" })
        .toBuffer();
      const logoMeta = await sharp(resizedLogo).metadata();
      const logoWidth = logoMeta.width ?? 80;
      sponsorSlots.push({
        buffer: resizedLogo,
        top: nextTop,
        left: SIZE - logoWidth - 40,
      });
    }
  }

  for (const slot of sponsorSlots) {
    layers.push({
      input: slot.buffer,
      top: slot.top,
      left: slot.left,
      blend: "over",
    });
  }

  const pngBuffer = await sharp(heroBackground)
    .composite(layers)
    .png()
    .toBuffer();

  return pngBuffer;
}
