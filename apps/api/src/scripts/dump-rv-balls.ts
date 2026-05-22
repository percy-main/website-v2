/**
 * One-off: fetch RV ball-by-ball + match overview for a single PC match and
 * dump as JSON files. Used to inspect raw RV data for new fixtures (e.g. the
 * Women's Softball game 7660052) without going through the sync ingest.
 *
 * Usage:
 *   RV_SHARED_SECRET=$(cat /tmp/.rv_secret) \
 *     pnpm --filter api exec tsx src/scripts/dump-rv-balls.ts 7660052 \
 *     /Users/alexyoung/Code/website-v2/.claude/tmp
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRvClient } from "../features/play-cricket/rv-client.ts";

async function main() {
  const matchId = process.argv[2];
  const outDir = process.argv[3];
  if (!matchId || !outDir) {
    console.error("usage: dump-rv-balls.ts <pcMatchId> <outDir>");
    process.exit(2);
  }

  const secret = process.env.RV_SHARED_SECRET;
  if (!secret) {
    console.error("RV_SHARED_SECRET not set");
    process.exit(2);
  }

  const rv = createRvClient({ sharedSecret: secret });

  const mapping = await rv.getMatchMapping(matchId);
  writeFileSync(
    join(outDir, `rv_mapping_${matchId}.json`),
    JSON.stringify(mapping, null, 2),
  );
  if (!mapping) {
    console.log(`no RV mapping for PC match ${matchId}`);
    return;
  }

  const overview = await rv.getMatch(mapping.rvMatchId);
  writeFileSync(
    join(outDir, `rv_match_${matchId}.json`),
    JSON.stringify(overview, null, 2),
  );
  if (!overview) {
    console.log(`no RV overview for ${mapping.rvMatchId}`);
    return;
  }

  // RV's MatchTeams[].Innings[] enumerates each team-innings. The
  // getballs endpoint wants the team's `result_id` plus the innings_number.
  const teams = (overview as unknown as { MatchTeams?: unknown[] }).MatchTeams;
  const allInnings: Array<{
    teamName: string;
    entityId: number;
    inningsNumber: number;
    resultId: number;
    inningsId: number;
  }> = [];
  if (Array.isArray(teams)) {
    for (const t of teams) {
      const team = t as {
        team_name?: string;
        entity_id?: number;
        result_id?: number;
        Innings?: Array<{
          innings_number?: number;
          innings_id?: number;
        }>;
      };
      for (const inn of team.Innings ?? []) {
        if (inn.innings_number != null && team.result_id != null) {
          allInnings.push({
            teamName: team.team_name ?? "",
            entityId: team.entity_id ?? 0,
            inningsNumber: inn.innings_number,
            resultId: team.result_id,
            inningsId: inn.innings_id ?? 0,
          });
        }
      }
    }
  }

  for (const inn of allInnings) {
    const balls = await rv.getBalls(
      mapping.rvMatchId,
      inn.resultId,
      inn.inningsNumber,
    );
    const fname = `rv_balls_${matchId}_team${inn.entityId}_inn${inn.inningsNumber}.json`;
    writeFileSync(
      join(outDir, fname),
      JSON.stringify({ team: inn, balls }, null, 2),
    );
    console.log(`  → ${fname}: ${balls.length} balls`);
  }

  console.log("done");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
