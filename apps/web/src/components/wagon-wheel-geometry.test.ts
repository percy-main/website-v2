import { describe, expect, it } from "vitest";
import { polar, shotRadius } from "./wagon-wheel-geometry";

describe("polar", () => {
  // SVG coordinates: +x is right, +y is DOWN. The wagon wheel labels Legside
  // on the right and Offside on the left, with the pitch pointing down. These
  // cases pin the orientation so the vertical axis can't silently flip again
  // (the bug where leg-side shots rendered mirrored top-to-bottom).
  const cases: Array<[string, number, [number, number]]> = [
    ["0deg points straight up (behind the wicket)", 0, [0, -100]],
    ["90deg points right (legside)", 90, [100, 0]],
    ["180deg points straight down (down the ground)", 180, [0, 100]],
    ["270deg points left (offside)", 270, [-100, 0]],
  ];

  it.each(cases)("%s", (_label, deg, [ex, ey]) => {
    const [x, y] = polar(deg, 100);
    expect(x).toBeCloseTo(ex, 6);
    expect(y).toBeCloseTo(ey, 6);
  });

  it("sends a leg-side drive (135deg) down and to the right", () => {
    const [x, y] = polar(135, 100);
    expect(x).toBeGreaterThan(0); // legside (right)
    expect(y).toBeGreaterThan(0); // lower half (down)
  });

  it("sends an off-side cut (225deg) down and to the left", () => {
    const [x, y] = polar(225, 100);
    expect(x).toBeLessThan(0); // offside (left)
    expect(y).toBeGreaterThan(0); // lower half (down)
  });
});

describe("shotRadius", () => {
  it("pins sixes and fours to fixed boundary radii", () => {
    expect(shotRadius({ runsBat: 6, shotLength: null })).toBe(278);
    expect(shotRadius({ runsBat: 4, shotLength: null })).toBe(256);
  });

  it("scales other shots by shot length", () => {
    expect(shotRadius({ runsBat: 2, shotLength: 50 })).toBe(210);
    expect(shotRadius({ runsBat: 1, shotLength: 25 })).toBe(105);
  });

  it("returns 0 when there is no shot length (e.g. a dot)", () => {
    expect(shotRadius({ runsBat: 0, shotLength: null })).toBe(0);
  });
});
