/**
 * Pure helpers extracted from be-the-keeper.tsx for unit testing.
 *
 * The component is a canvas mini-game and most of its surface area is
 * imperative rendering against a CanvasRenderingContext2D. Anything that
 * mutates GameState refs, draws, schedules animation frames, or plays audio
 * is left in the component. Only side-effect-free numeric helpers and a
 * thin localStorage wrapper live here.
 */

// ── Game tuning constants ───────────────────────────────────

export const MAX_LIVES = 3;
export const CATCHES_PER_LEVEL = 5;
export const GAP_BETWEEN = 0.9;
export const HIGH_SCORE_STORAGE_KEY = "pmcc_keeper_hi";

// ── Math ─────────────────────────────────────────────────────

/** Clamp `v` to the inclusive range `[min, max]`. */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ── Difficulty curves ────────────────────────────────────────

/**
 * Catch radius scales linearly with canvas width but is capped so very wide
 * canvases don't make catching trivial.
 */
export function catchRadiusForWidth(w: number): number {
  return Math.min(w * 0.055, 40);
}

/**
 * Pause between deliveries shrinks as the level rises (down to 0.5s minimum).
 */
export function gapAfterDelivery(level: number): number {
  return GAP_BETWEEN - Math.min(level * 0.06, 0.4);
}

/**
 * Points awarded for a clean catch.
 *
 * Base 10 points + 5 per streak beyond the first, multiplied by a level
 * bonus that grows by 0.5 per level above 1. Result is rounded to an integer.
 */
export function calculateCatchPoints(streak: number, level: number): number {
  const base = 10 + Math.max(0, streak - 1) * 5;
  const levelMult = 1 + (level - 1) * 0.5;
  return Math.round(base * levelMult);
}

/** True if the keeper's gloves were inside the catch radius at impact. */
export function isCatch(distance: number, catchRadius: number): boolean {
  return distance <= catchRadius;
}

/**
 * "So close" near-miss band: missed but within 1.6x catch radius.
 * Only meaningful when {@link isCatch} returned false.
 */
export function isSoClose(distance: number, catchRadius: number): boolean {
  return distance <= catchRadius * 1.6;
}

// ── Ball physics (pure given numeric inputs) ─────────────────

export interface DeliveryShape {
  targetX: number;
  progress: number;
  swing: number;
  seam: number;
  bounceZ: number;
  bounceH: number;
  late: number;
}

export interface BallScreenPos {
  x: number;
  y: number;
  r: number;
}

/**
 * Project a delivery's current progress (0..1) onto canvas coordinates.
 *
 * Pure: depends only on the delivery's numeric fields and canvas dimensions,
 * so it can be tested without a CanvasRenderingContext2D.
 */
export function ballPos(
  b: DeliveryShape,
  w: number,
  h: number,
): BallScreenPos {
  const p = b.progress;
  const t = Math.pow(p, 1.5);

  const hy = h * 0.22;
  const stumpY = h * 0.72;
  const pitchY = h * 0.85;

  const arrX = w / 2 + b.targetX * w * 0.38;
  // Late swing kicks in more after bounce
  const lateFactor = b.late * Math.pow(Math.max(0, p - 0.5) * 2, 2);
  const swPx =
    b.swing * w * 0.18 * p * p + Math.sign(b.swing) * lateFactor * w * 0.12;
  let smPx = 0;
  if (p > b.bounceZ) {
    smPx = b.seam * w * 0.14 * ((p - b.bounceZ) / (1 - b.bounceZ));
  }
  const x = w / 2 + (arrX - w / 2 + swPx + smPx) * t;

  let y: number;
  if (p <= b.bounceZ) {
    const bt = p / b.bounceZ;
    const pitchAtBounce = hy + (pitchY - hy) * Math.pow(b.bounceZ, 1.5);
    y = hy + (pitchAtBounce - hy) * Math.pow(bt, 1.1);
  } else {
    const bt = (p - b.bounceZ) / (1 - b.bounceZ);
    const pitchAtBounce = hy + (pitchY - hy) * Math.pow(b.bounceZ, 1.5);
    const peakY = pitchAtBounce - b.bounceH * h * 0.14;
    const inv = 1 - bt;
    y = inv * inv * pitchAtBounce + 2 * inv * bt * peakY + bt * bt * stumpY;
  }

  const r = 3 + 16 * t;
  return { x, y, r };
}

// ── Persisted high score ─────────────────────────────────────

/**
 * Read the persisted high score from localStorage.
 *
 * Returns 0 if storage is unavailable or the stored value is missing/invalid.
 */
export function loadHighScore(): number {
  try {
    const raw = localStorage.getItem(HIGH_SCORE_STORAGE_KEY) ?? "0";
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

/**
 * Persist the high score; silently ignores storage errors (Safari private
 * mode, disabled cookies, etc.).
 */
export function saveHighScore(score: number): void {
  try {
    localStorage.setItem(HIGH_SCORE_STORAGE_KEY, String(score));
  } catch {
    // localStorage unavailable
  }
}
