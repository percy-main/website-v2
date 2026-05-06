import { tool } from "ai";
import {
  evidenceRecordInputSchema,
  type EvidenceAccumulator,
} from "../report/evidence.ts";

export interface RecordEvidenceToolDeps {
  // The researcher's per-call accumulator. record_evidence pushes into it; the
  // analyst phase reads it via accumulator.snapshot().
  accumulator: EvidenceAccumulator;
}

/**
 * record_evidence — the researcher's only output channel.
 *
 * Researcher fetches data via ask_db / pc_* / weather_get / fact_retrieve as
 * usual, then converts each useful piece into an EvidenceRecord by calling
 * this tool. The analyst phase sees ONLY accumulated records — never raw
 * tool output, never narrative the researcher might have authored.
 */
export function createRecordEvidenceTool(deps: RecordEvidenceToolDeps) {
  const { accumulator } = deps;

  return {
    record_evidence: tool({
      description: `Record one piece of evidence for the analyst phase to consume. This is the ONLY way you communicate with the analyst — your final assistant text is discarded; only records you push here survive.

Call this every time you find a piece of data, fact, or stat the report should be grounded in. Be liberal — emit one record per atom of information. Smaller, more numerous records are better than one record that smushes five claims together.

The accumulator dedupes on (sourceRef + content), so you can re-emit the same record without consequences if you're not sure whether you already did.

Examples:

1. After ask_db returned Smith's batting average:
   record_evidence({
     sourceType: "db",
     sourceRef: "ask_db:Smith 2026 batting average and high score",
     claimType: "db_aggregate",
     content: "Smith averages 38.4 across 12 innings in the 2026 season (HS 76).",
     numericValue: "38.4",
     context: { player: "Smith", season: 2026 },
     confidence: 5,
     permanence: "seasonal"
   })

2. After ask_play_cricket returned a Newcastle match (sourceTool: "pc_match_summary", matchId 1234567):
   record_evidence({
     sourceType: "play_cricket",
     sourceRef: "pc_match_summary:1234567",
     sourceUrl: "https://percymain.play-cricket.com/website/results/1234567",
     claimType: "pc_match",
     content: "Dance took 5/27 (8 overs) for Newcastle 1st XI vs Tynemouth on 18 May 2026; Newcastle won by 42 runs.",
     numericValue: "5",
     context: { player: "Dance", team: "Newcastle 1st XI", matchDate: "2026-05-18" },
     confidence: 5,
     permanence: "ephemeral"
   })

3. After fact_retrieve returned a captain-recorded fact:
   record_evidence({
     sourceType: "fact",
     sourceRef: "fact:0c92e0a4-2d11-4b7d-8f2c-c4e0b2d50d1e",
     claimType: "captain_fact",
     content: "Captain has recorded: 'Dance bowls full and straight, gets bounce off the deck.'",
     confidence: 5,
     permanence: "permanent"
   })

4. After weather_get for the ground:
   record_evidence({
     sourceType: "weather",
     sourceRef: "weather:54.99,-1.45,2026-05-10",
     sourceUrl: "https://api.open-meteo.com/v1/forecast?...",
     claimType: "weather",
     content: "Forecast for 10 May 2026 at Percy Main: 14°C, light NE breeze, 25% precipitation probability, mostly cloudy.",
     numericValue: "25",
     confidence: 4,
     permanence: "ephemeral"
   })

5. After ask_play_cricket returned a league table (one record carries the WHOLE table — DO NOT emit per-row records):
   record_evidence({
     sourceType: "play_cricket",
     sourceRef: "pc_league_table:<divisionId>",
     claimType: "league_standings",
     content: "NTCL Division 4 North standings: Backworth 1st are 1st of 10 on 96 pts (W:7 L:1).",
     confidence: 5,
     permanence: "ephemeral",
     leagueTable: {
       name: "NTCL Division 4 North",
       columns: ["#", "Team", "P", "W", "L", "T", "Pts"],
       rows: [
         { values: ["1", "Backworth CC 1st XI", "8", "7", "1", "0", "96"], highlight: "opposition" },
         { values: ["2", "Other CC 1st XI", "8", "5", "3", "0", "72"] },
         { values: ["3", "Percy Main CC 1st XI", "8", "4", "4", "0", "60"], highlight: "us" }
       ]
     }
   })

claimType matters — the analyst's mechanics rule (claims about line, length, movement, footwork, shot, glovework, captaincy) requires evidence with claimType "captain_fact" or "club_fact". Stats and scorecard data (db_aggregate, pc_match, dismissal_pattern) CANNOT support mechanics claims. Be honest about claimType.

Hard rules:
- Do NOT emit unsupported mechanics in content. If ask_play_cricket returned a wicket count, content should describe the count — not invent line/length to explain it. ("Dance took 5 wickets last week (5/27 in 8 overs)" is fine. "Dance's wickets came from hitting a full length" is fabrication and forbidden — we have no line/length data unless a fact_retrieve says so.)
- Do NOT batch multiple claims into one record. One stat per record.
- Do NOT include analytical opinions or recommendations — that's the analyst's job. Stick to data.

Returns: { id, deduped, totalRecords }. The id is the record's stable handle the analyst will reference.`,
      inputSchema: evidenceRecordInputSchema,
      // eslint-disable-next-line @typescript-eslint/require-await -- AI SDK execute is async; this just pushes into a synchronous accumulator.
      execute: async (input) => {
        const { id, deduped } = accumulator.add(input);
        return {
          id,
          deduped,
          totalRecords: accumulator.size(),
        };
      },
    }),
  };
}

export type RecordEvidenceTools = ReturnType<typeof createRecordEvidenceTool>;
