import type { UIMessageStreamWriter } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createPlayCricketCitationTools } from "./play-cricket-citations.ts";

const opts = {
  toolCallId: "test",
  messages: [],
  abortSignal: undefined,
} as never;

function makeWriter() {
  return {
    write: vi.fn(),
    merge: vi.fn(),
    onError: undefined,
  } as unknown as UIMessageStreamWriter & { write: ReturnType<typeof vi.fn> };
}

describe("cite_match — Play Cricket match citation", () => {
  it("emits a data-match-citation part with the supplied display fields", async () => {
    const writer = makeWriter();
    const { cite_match } = createPlayCricketCitationTools({ writer });
    const exec = cite_match.execute;
    if (!exec) throw new Error("no execute");

    const result = (await exec(
      {
        matchId: "7262912",
        claim: "We beat Backworth by 47 runs.",
        matchDate: "26/04/2025",
        homeTeam: "Percy Main CC, 1st XI",
        awayTeam: "Backworth Hall CC, 1st XI",
        groundName: "Preston Avenue",
        competition: "NTCL Premier Division",
        result: "Percy Main won by 47 runs",
      } as never,
      opts,
    )) as { cited: boolean; matchId: string; citationId: string };

    expect(result.cited).toBe(true);
    expect(result.matchId).toBe("7262912");
    expect(typeof result.citationId).toBe("string");

    expect(writer.write).toHaveBeenCalledTimes(1);
    const part = (writer.write.mock.calls[0] as unknown[])[0] as {
      type: string;
      id: string;
      data: {
        matchId: string;
        claim: string;
        matchDate?: string;
        homeTeam?: string;
        awayTeam?: string;
        groundName?: string;
        competition?: string;
        result?: string;
      };
    };
    expect(part.type).toBe("data-match-citation");
    expect(part.id).toBe(result.citationId);
    expect(part.data).toMatchObject({
      matchId: "7262912",
      claim: "We beat Backworth by 47 runs.",
      matchDate: "26/04/2025",
      homeTeam: "Percy Main CC, 1st XI",
      awayTeam: "Backworth Hall CC, 1st XI",
      result: "Percy Main won by 47 runs",
    });
  });

  it("works with only required fields (matchId + claim) — display fields are optional", async () => {
    const writer = makeWriter();
    const { cite_match } = createPlayCricketCitationTools({ writer });
    const exec = cite_match.execute;
    if (!exec) throw new Error("no execute");

    const result = (await exec(
      { matchId: "1234", claim: "Match cited" } as never,
      opts,
    )) as { cited: boolean };

    expect(result.cited).toBe(true);
    expect(writer.write).toHaveBeenCalledTimes(1);
    const part = (writer.write.mock.calls[0] as unknown[])[0] as {
      data: { matchId: string };
    };
    expect(part.data.matchId).toBe("1234");
  });

  it("does not throw when no writer is supplied (unit-test mode)", async () => {
    const { cite_match } = createPlayCricketCitationTools({});
    const exec = cite_match.execute;
    if (!exec) throw new Error("no execute");
    const result = (await exec(
      { matchId: "1234", claim: "x" } as never,
      opts,
    )) as { cited: boolean };
    expect(result.cited).toBe(true);
  });
});

describe("cite_player_stats — Play Cricket player aggregate citation", () => {
  it("emits a data-player-stats-citation part and stamps the Percy Main club_id by default", async () => {
    const writer = makeWriter();
    const { cite_player_stats } = createPlayCricketCitationTools({ writer });
    const exec = cite_player_stats.execute;
    if (!exec) throw new Error("no execute");

    const result = (await exec(
      {
        playerId: "6577518",
        playerName: "John Smith",
        statType: "batting",
        claim: "Smith averages 12.3 across 18 innings vs us this season.",
        season: 2025,
        teamId: "68498",
        gameType: "League",
      } as never,
      opts,
    )) as { cited: boolean; playerId: string; statType: string };

    expect(result.cited).toBe(true);
    expect(result.playerId).toBe("6577518");
    expect(result.statType).toBe("batting");

    expect(writer.write).toHaveBeenCalledTimes(1);
    const part = (writer.write.mock.calls[0] as unknown[])[0] as {
      type: string;
      data: {
        playerId: string;
        statType: string;
        season?: number;
        teamId?: string;
        gameType?: string;
        clubId?: string;
      };
    };
    expect(part.type).toBe("data-player-stats-citation");
    expect(part.data.playerId).toBe("6577518");
    expect(part.data.statType).toBe("batting");
    expect(part.data.season).toBe(2025);
    expect(part.data.teamId).toBe("68498");
    expect(part.data.gameType).toBe("League");
    // Stamped server-side so the FE doesn't have to know our club_id.
    expect(part.data.clubId).toBe("134");
  });

  it("accepts each of batting / bowling / fielding", async () => {
    const writer = makeWriter();
    const { cite_player_stats } = createPlayCricketCitationTools({ writer });
    const exec = cite_player_stats.execute;
    if (!exec) throw new Error("no execute");
    for (const statType of ["batting", "bowling", "fielding"] as const) {
      const result = (await exec(
        { playerId: "1", statType, claim: "x" } as never,
        opts,
      )) as { cited: boolean; statType: string };
      expect(result.cited).toBe(true);
      expect(result.statType).toBe(statType);
    }
    expect(writer.write).toHaveBeenCalledTimes(3);
  });
});
