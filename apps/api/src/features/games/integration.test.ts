import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import { getWagonWheel } from "./service.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 30_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

async function seedMatchResult(matchId: string) {
  await ctx.db
    .insertInto("match_result")
    .values({
      id: crypto.randomUUID(),
      match_id: matchId,
      home_team_id: "home",
      away_team_id: "away",
      home_team_name: "1st XI",
      away_team_name: "1st XI",
      match_date: "2026-06-06",
      season: 2026,
    })
    .onConflict((oc) => oc.column("match_id").doNothing())
    .execute();
}

async function seedBall(args: {
  matchId: string;
  rvResultId: string;
  over: number;
  ball: number;
  lDesc: string;
  ballTimeUtc: string | null;
}) {
  await ctx.db
    .insertInto("match_ball")
    .values({
      match_id: args.matchId,
      rv_match_id: `rv-${args.matchId}`,
      rv_result_id: args.rvResultId,
      innings_number: 1, // RV serves both batting innings as innings_number=1
      over_no: args.over,
      ball_no: args.ball,
      ball_no_disp: args.ball,
      runs_bat: 1,
      runs_extra: 0,
      l_desc: args.lDesc,
      s_desc: args.lDesc,
      ball_time_utc: args.ballTimeUtc,
    })
    .execute();
}

describe("getWagonWheel innings ordering", () => {
  it("orders innings by batting chronology, not rv_result_id", async () => {
    // The team batting FIRST (earlier ball times) is given the HIGHER
    // rv_result_id, and the team batting SECOND the LOWER id. Sorting by
    // rv_result_id would reverse the innings and mislabel the tabs.
    const matchId = "match-ww-chrono";
    await seedMatchResult(matchId);
    await seedBall({
      matchId,
      rvResultId: "200",
      over: 0,
      ball: 1,
      lDesc: "FIRST-INN",
      ballTimeUtc: "2026-06-06T10:00:00Z",
    });
    await seedBall({
      matchId,
      rvResultId: "100",
      over: 0,
      ball: 1,
      lDesc: "SECOND-INN",
      ballTimeUtc: "2026-06-06T14:00:00Z",
    });

    const result = await getWagonWheel(ctx.db)(matchId);

    expect(result.innings).toHaveLength(2);
    expect(result.innings[0]?.inningsNumber).toBe(1);
    expect(result.innings[0]?.balls[0]?.lDesc).toBe("FIRST-INN");
    expect(result.innings[1]?.inningsNumber).toBe(2);
    expect(result.innings[1]?.balls[0]?.lDesc).toBe("SECOND-INN");
  });

  it("falls back to rv_result_id order when ball times are absent", async () => {
    const matchId = "match-ww-notime";
    await seedMatchResult(matchId);
    await seedBall({
      matchId,
      rvResultId: "b",
      over: 0,
      ball: 1,
      lDesc: "RESULT-B",
      ballTimeUtc: null,
    });
    await seedBall({
      matchId,
      rvResultId: "a",
      over: 0,
      ball: 1,
      lDesc: "RESULT-A",
      ballTimeUtc: null,
    });

    const result = await getWagonWheel(ctx.db)(matchId);

    expect(result.innings).toHaveLength(2);
    expect(result.innings[0]?.balls[0]?.lDesc).toBe("RESULT-A");
    expect(result.innings[1]?.balls[0]?.lDesc).toBe("RESULT-B");
  });

  it("falls back to rv_result_id order when only some innings are timed", async () => {
    // Mixed timestamps give no reliable cross-innings order, so the timed
    // innings must NOT float to the front — order by rv_result_id instead.
    const matchId = "match-ww-mixed";
    await seedMatchResult(matchId);
    await seedBall({
      matchId,
      rvResultId: "200",
      over: 0,
      ball: 1,
      lDesc: "UNTIMED-200",
      ballTimeUtc: null,
    });
    await seedBall({
      matchId,
      rvResultId: "100",
      over: 0,
      ball: 1,
      lDesc: "TIMED-100",
      ballTimeUtc: "2026-06-06T14:00:00Z",
    });

    const result = await getWagonWheel(ctx.db)(matchId);

    expect(result.innings).toHaveLength(2);
    // rv_result_id "100" sorts before "200" despite "200" being untimed.
    expect(result.innings[0]?.balls[0]?.lDesc).toBe("TIMED-100");
    expect(result.innings[1]?.balls[0]?.lDesc).toBe("UNTIMED-200");
  });
});
