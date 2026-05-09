import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ballPos,
  calculateCatchPoints,
  catchRadiusForWidth,
  CATCHES_PER_LEVEL,
  clamp,
  gapAfterDelivery,
  GAP_BETWEEN,
  HIGH_SCORE_STORAGE_KEY,
  isCatch,
  isSoClose,
  loadHighScore,
  MAX_LIVES,
  saveHighScore,
  type DeliveryShape,
} from "./be-the-keeper.lib";

describe("clamp", () => {
  it("returns the value when within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps below the minimum", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it("clamps above the maximum", () => {
    expect(clamp(42, 0, 10)).toBe(10);
  });
});

describe("catchRadiusForWidth", () => {
  it("scales with width up to the cap", () => {
    expect(catchRadiusForWidth(500)).toBeCloseTo(27.5, 5);
  });

  it("caps at 40px on very wide canvases", () => {
    expect(catchRadiusForWidth(2000)).toBe(40);
  });
});

describe("gapAfterDelivery", () => {
  it("matches GAP_BETWEEN minus level scaling at level 1", () => {
    expect(gapAfterDelivery(1)).toBeCloseTo(GAP_BETWEEN - 0.06, 5);
  });

  it("clamps the level penalty to 0.4 at high levels", () => {
    // 0.06 * 7 = 0.42 → clamped to 0.4 → 0.9 - 0.4 = 0.5
    expect(gapAfterDelivery(20)).toBeCloseTo(0.5, 5);
  });

  it("monotonically decreases with level until the cap", () => {
    expect(gapAfterDelivery(1)).toBeGreaterThan(gapAfterDelivery(3));
    expect(gapAfterDelivery(3)).toBeGreaterThan(gapAfterDelivery(6));
  });
});

describe("calculateCatchPoints", () => {
  it("awards base 10 for first catch at level 1", () => {
    expect(calculateCatchPoints(1, 1)).toBe(10);
  });

  it("adds 5 per streak step beyond the first", () => {
    // streak=3, level=1 → (10 + 2*5) * 1 = 20
    expect(calculateCatchPoints(3, 1)).toBe(20);
  });

  it("multiplies by level bonus (1 + 0.5 * (level-1))", () => {
    // streak=1, level=3 → 10 * (1 + 1.0) = 20
    expect(calculateCatchPoints(1, 3)).toBe(20);
  });

  it("treats streak 0 like streak 1 (no negative bonus)", () => {
    expect(calculateCatchPoints(0, 1)).toBe(10);
  });

  it("rounds non-integer products", () => {
    // streak=2, level=2 → (10 + 5) * 1.5 = 22.5 → 23
    expect(calculateCatchPoints(2, 2)).toBe(23);
  });
});

describe("isCatch / isSoClose", () => {
  it("isCatch true when distance is within radius", () => {
    expect(isCatch(20, 30)).toBe(true);
    expect(isCatch(30, 30)).toBe(true); // boundary inclusive
  });

  it("isCatch false when distance exceeds radius", () => {
    expect(isCatch(31, 30)).toBe(false);
  });

  it("isSoClose true within 1.6x radius", () => {
    expect(isSoClose(40, 30)).toBe(true); // 40 <= 48
    expect(isSoClose(48, 30)).toBe(true);
  });

  it("isSoClose false beyond 1.6x radius", () => {
    expect(isSoClose(49, 30)).toBe(false);
  });
});

describe("ballPos", () => {
  const baseDelivery: DeliveryShape = {
    targetX: 0,
    progress: 0,
    swing: 0,
    seam: 0,
    bounceZ: 0.5,
    bounceH: 0.4,
    late: 0,
  };

  it("starts near the bowler's end (top of canvas) and tiny radius", () => {
    const pos = ballPos(baseDelivery, 800, 600);
    expect(pos.r).toBeCloseTo(3, 5);
    // hy = 600 * 0.22 = 132
    expect(pos.y).toBeCloseTo(132, 5);
    // No swing/seam, target=0 → x stays centered
    expect(pos.x).toBeCloseTo(400, 5);
  });

  it("ends near the stumps line at progress=1", () => {
    const pos = ballPos({ ...baseDelivery, progress: 1 }, 800, 600);
    // stumpY = 600 * 0.72 = 432
    expect(pos.y).toBeCloseTo(432, 5);
    expect(pos.r).toBeCloseTo(19, 5); // 3 + 16 * 1
  });

  it("offsets x toward targetX as progress increases", () => {
    const offset = ballPos(
      { ...baseDelivery, targetX: 1, progress: 1 },
      800,
      600,
    );
    // arrX = 400 + 1 * 800 * 0.38 = 704; t = 1; no swing/seam
    expect(offset.x).toBeCloseTo(704, 5);
  });

  it("is deterministic — same inputs yield same outputs", () => {
    const a = ballPos({ ...baseDelivery, progress: 0.7 }, 1024, 768);
    const b = ballPos({ ...baseDelivery, progress: 0.7 }, 1024, 768);
    expect(a).toEqual(b);
  });
});

describe("high score persistence", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
      key: () => null,
      length: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 0 when nothing is stored", () => {
    expect(loadHighScore()).toBe(0);
  });

  it("round-trips a saved score", () => {
    saveHighScore(123);
    expect(loadHighScore()).toBe(123);
  });

  it("returns 0 for non-numeric stored values", () => {
    localStorage.setItem(HIGH_SCORE_STORAGE_KEY, "not-a-number");
    expect(loadHighScore()).toBe(0);
  });

  it("does not throw when localStorage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(loadHighScore()).toBe(0);
    expect(() => {
      saveHighScore(99);
    }).not.toThrow();
  });
});

describe("constants", () => {
  it("expose game tuning values", () => {
    expect(MAX_LIVES).toBe(3);
    expect(CATCHES_PER_LEVEL).toBe(5);
    expect(GAP_BETWEEN).toBeCloseTo(0.9, 5);
  });
});
