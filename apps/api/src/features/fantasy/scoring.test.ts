import { describe, expect, it } from "vitest";
import {
  calculateBattingPoints,
  calculateBowlingPoints,
  calculateFieldingPoints,
  calculateMatchPoints,
} from "./scoring.js";

describe("calculateBattingPoints", () => {
  it("calculates basic runs, fours, sixes", () => {
    const result = calculateBattingPoints({
      runs: 30,
      balls: 25,
      fours: 4,
      sixes: 1,
      notOut: false,
    });
    // 30 runs + 4 fours + 1*2 sixes = 36
    expect(result.runs).toBe(30);
    expect(result.fours).toBe(4);
    expect(result.sixes).toBe(2);
    expect(result.total).toBe(36);
  });

  it("awards fifty bonus for 50-99 runs", () => {
    const result = calculateBattingPoints({
      runs: 75,
      balls: 60,
      fours: 8,
      sixes: 2,
      notOut: false,
    });
    expect(result.fiftyBonus).toBe(20);
    expect(result.hundredBonus).toBe(0);
  });

  it("awards hundred bonus (not fifty) for 100+", () => {
    const result = calculateBattingPoints({
      runs: 100,
      balls: 80,
      fours: 10,
      sixes: 3,
      notOut: false,
    });
    expect(result.fiftyBonus).toBe(0);
    expect(result.hundredBonus).toBe(50);
  });

  it("applies duck penalty for 0 runs out", () => {
    const result = calculateBattingPoints({
      runs: 0,
      balls: 3,
      fours: 0,
      sixes: 0,
      notOut: false,
    });
    expect(result.duckPenalty).toBe(-10);
    expect(result.total).toBe(-10);
  });

  it("no duck penalty for not out on 0", () => {
    const result = calculateBattingPoints({
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      notOut: true,
    });
    expect(result.duckPenalty).toBe(0);
    expect(result.total).toBe(0);
  });
});

describe("calculateBowlingPoints", () => {
  it("calculates wickets and maidens", () => {
    const result = calculateBowlingPoints({
      overs: "8",
      maidens: 2,
      runs: 30,
      wickets: 2,
    });
    expect(result.wickets).toBe(20); // 2*10
    expect(result.maidens).toBe(20); // 2*10
    // economy = 30/8 = 3.75 < 4.0, so +10 economy bonus
    expect(result.economyBonus).toBe(10);
    expect(result.total).toBe(50);
  });

  it("awards three-wicket bonus", () => {
    const result = calculateBowlingPoints({
      overs: "10",
      maidens: 0,
      runs: 40,
      wickets: 3,
    });
    expect(result.threeWicketBonus).toBe(15);
    expect(result.fiveWicketBonus).toBe(0);
  });

  it("awards five-wicket bonus (not three)", () => {
    const result = calculateBowlingPoints({
      overs: "10",
      maidens: 0,
      runs: 40,
      wickets: 5,
    });
    expect(result.threeWicketBonus).toBe(0);
    expect(result.fiveWicketBonus).toBe(30);
  });

  it("awards economy bonus for < 4.0 with 3+ overs", () => {
    const result = calculateBowlingPoints({
      overs: "5",
      maidens: 0,
      runs: 15,
      wickets: 0,
    });
    // economy = 15/5 = 3.0 < 4.0
    expect(result.economyBonus).toBe(10);
  });

  it("applies economy penalty for > 7.0 with 3+ overs", () => {
    const result = calculateBowlingPoints({
      overs: "4",
      maidens: 0,
      runs: 35,
      wickets: 0,
    });
    // economy = 35/4 = 8.75 > 7.0
    expect(result.economyBonus).toBe(-10);
  });

  it("no economy bonus/penalty under 3 overs", () => {
    const result = calculateBowlingPoints({
      overs: "2",
      maidens: 0,
      runs: 2,
      wickets: 0,
    });
    expect(result.economyBonus).toBe(0);
  });

  it("handles partial overs (e.g. 9.3)", () => {
    const result = calculateBowlingPoints({
      overs: "9.3",
      maidens: 0,
      runs: 25,
      wickets: 1,
    });
    // 9.3 overs = 9.5 overs, economy = 25/9.5 ≈ 2.63 < 4.0
    expect(result.economyBonus).toBe(10);
  });
});

describe("calculateFieldingPoints", () => {
  it("calculates non-keeper catches", () => {
    const result = calculateFieldingPoints({
      catches: 2,
      runOuts: 0,
      stumpings: 0,
      isWicketkeeper: false,
    });
    expect(result.catches).toBe(20); // 2*10
  });

  it("calculates keeper catches at reduced rate", () => {
    const result = calculateFieldingPoints({
      catches: 3,
      runOuts: 0,
      stumpings: 0,
      isWicketkeeper: true,
    });
    expect(result.catches).toBe(15); // 3*5
  });

  it("calculates run outs and stumpings", () => {
    const result = calculateFieldingPoints({
      catches: 0,
      runOuts: 1,
      stumpings: 2,
      isWicketkeeper: true,
    });
    expect(result.runOuts).toBe(15);
    expect(result.stumpings).toBe(30);
  });
});

describe("calculateMatchPoints", () => {
  it("combines all categories with win bonus", () => {
    const result = calculateMatchPoints(
      { runs: 50, balls: 40, fours: 5, sixes: 1, notOut: false },
      { overs: "8", maidens: 1, runs: 30, wickets: 2 },
      { catches: 1, runOuts: 0, stumpings: 0, isWicketkeeper: false },
      { teamWon: true },
    );

    expect(result.batting).toBeTruthy();
    expect(result.bowling).toBeTruthy();
    expect(result.fielding).toBeTruthy();
    expect(result.winBonus).toBe(10);
    expect(result.total).toBe(
      (result.batting?.total ?? 0) +
        (result.bowling?.total ?? 0) +
        (result.fielding?.total ?? 0) +
        result.winBonus,
    );
  });

  it("handles null disciplines", () => {
    const result = calculateMatchPoints(
      null,
      null,
      { catches: 1, runOuts: 0, stumpings: 0, isWicketkeeper: false },
      { teamWon: false },
    );
    expect(result.batting).toBeNull();
    expect(result.bowling).toBeNull();
    expect(result.winBonus).toBe(0);
    expect(result.total).toBe(10); // just fielding catch
  });
});
