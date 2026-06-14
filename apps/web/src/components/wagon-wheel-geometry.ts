// Pure geometry helpers for the wagon wheel, kept separate from the React
// component so the angle/radius conventions can be unit-tested without pulling
// in the component graph (Dialog, hooks, etc.).

export const ROPE = 240;
// Must be > the maximum shotRadius (278 for sixes) plus marker padding so
// dismissal rings on boundaries don't clip against the viewBox edge.
export const VIEW = 295;
export const MAX_LEN = 50;

export function shotRadius(b: {
  runsBat: number;
  shotLength: number | null;
}): number {
  if (b.runsBat >= 6) return 278;
  if (b.runsBat >= 4) return 256;
  if (b.shotLength == null) return 0;
  return (b.shotLength / MAX_LEN) * 210;
}

// Maps a shot angle (degrees) and radius to SVG [x, y] coordinates.
//
// SVG's y-axis points down, so we negate cos to keep the shot_angle convention
// upright: 0deg points up (behind the wicket) and the angle sweeps clockwise
// through legside (90deg, right) to straight (180deg, down the ground) to
// offside (270deg, left). Without the negation the vertical axis is flipped
// and shots render mirrored top-to-bottom versus Play-Cricket.
export function polar(deg: number, r: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [Math.sin(a) * r, -Math.cos(a) * r];
}
