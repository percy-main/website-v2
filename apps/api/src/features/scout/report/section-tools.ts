import {
  chartSpecSchema,
  scoutLeagueTableSchema,
  scoutReportContentSchema,
  type ChartSpec,
  type ScoutLeagueTable,
  type ScoutReportChart,
  type ScoutReportContent,
  type ScoutReportPlayer,
} from "@percy-main/shared";
import { tool } from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

/**
 * toContent() return shape. Three outcomes:
 *  - ok:true with the assembled content
 *  - ok:false reason:"missing"      — required set_* calls weren't made
 *  - ok:false reason:"schema"       — sections set, but the assembled
 *      object failed shared-schema validation (e.g. > 15 add_*_player
 *      calls, intro under 20 chars, > 4 charts in a section). The
 *      message names the specific constraint that failed.
 */
export type ToContentResult =
  | { ok: true; content: ScoutReportContent }
  | { ok: false; reason: "missing"; missing: string[] }
  | { ok: false; reason: "schema"; message: string };

/**
 * Tool-driven report output.
 *
 * The report agent doesn't emit a JSON object at the end — instead it calls
 * `set_intro`, `set_toss_decision`, `add_our_player`, `chart_render`, etc.
 * as it works. Each call validates its input via Zod (so a bad value fails
 * one tool call rather than blowing up the whole report) and writes into a
 * per-run accumulator. After the loop ends, runReport reads the accumulator
 * and assembles a ScoutReportContent for the renderer.
 *
 * Why this beats "emit JSON at the end":
 *  - DeepSeek frequently prefaces its final message with prose ("Now let me
 *    summarise..." / "Let me check one more thing..."), and the parse path
 *    keeps failing. Per-call validation has no such fragility.
 *  - The model can refine sections incrementally — call set_intro early,
 *    set_toss_decision after weather lands, set_tactics last. Last write
 *    wins for set_*; add_* appends in call order.
 *  - Failures point at one section, not "the whole JSON didn't parse".
 */

// Input schemas — mirror the structure of scoutReportContentSchema but with
// model-facing descriptions. We keep these inline rather than re-exporting
// from shared because the descriptions are tuned for tool use.

const playerStatInputSchema = z.object({
  label: z
    .string()
    .min(1)
    .describe("Stat label, e.g. 'Average', 'SR', 'Wickets'."),
  value: z.string().min(1).describe("Formatted value, e.g. '34.2' or '12*'."),
});

const playerInputSchema = z.object({
  name: z.string().min(1),
  role: z
    .string()
    .optional()
    .describe("Optional. e.g. 'Right-handed bat / off-spin', 'Wicketkeeper'."),
  notes: z
    .string()
    .optional()
    .describe(
      "1–3 sentences of analyst commentary (recent form, threats, weaknesses).",
    ),
  stats: z
    .array(playerStatInputSchema)
    .max(8)
    .optional()
    .describe("Headline stats, max 8. Pick the most relevant for the matchup."),
});

const weatherInputSchema = z.object({
  summary: z
    .string()
    .min(5)
    .describe(
      "Plain-English forecast summary (temp, wind, rain probability, conditions).",
    ),
  retrievedAt: z
    .string()
    .min(1)
    .describe(
      "When the forecast was retrieved, e.g. '2026-05-04 09:23 BST'. Cite freshness.",
    ),
  source: z.string().optional().describe("Source label, e.g. 'Open-Meteo'."),
});

const sectionEnum = z.enum(["ourPlayers", "theirPlayers"]);

/** Per-run mutable store. set_* methods overwrite; add_* methods append. */
export class ReportContentAccumulator {
  private _intro?: string;
  private _tossDecision?: string;
  private _overallStrategy?: string;
  private _keyMatchups?: string;
  private _tactics?: string;
  private _conclusion?: string;
  private _weather?: ScoutReportContent["weather"];
  private _leagueTable?: ScoutLeagueTable;
  private _ourPlayers: ScoutReportPlayer[] = [];
  private _theirPlayers: ScoutReportPlayer[] = [];
  private _ourPlayersCharts: ScoutReportChart[] = [];
  private _theirPlayersCharts: ScoutReportChart[] = [];
  private _chartSpecs = new Map<string, ChartSpec>();

  setIntro(text: string): void {
    this._intro = text;
  }
  setTossDecision(text: string): void {
    this._tossDecision = text;
  }
  setOverallStrategy(text: string): void {
    this._overallStrategy = text;
  }
  setKeyMatchups(text: string): void {
    this._keyMatchups = text;
  }
  setTactics(text: string): void {
    this._tactics = text;
  }
  setConclusion(text: string): void {
    this._conclusion = text;
  }
  setWeather(weather: ScoutReportContent["weather"]): void {
    this._weather = weather;
  }
  setLeagueTable(table: ScoutLeagueTable): void {
    this._leagueTable = table;
  }
  addOurPlayer(player: ScoutReportPlayer): void {
    this._ourPlayers.push(player);
  }
  addTheirPlayer(player: ScoutReportPlayer): void {
    this._theirPlayers.push(player);
  }
  addChart(
    section: "ourPlayers" | "theirPlayers",
    caption: string,
    spec: ChartSpec,
  ): string {
    const chartId = `chart_${randomUUID().slice(0, 8)}`;
    this._chartSpecs.set(chartId, spec);
    if (section === "ourPlayers") {
      this._ourPlayersCharts.push({ caption, chartId });
    } else {
      this._theirPlayersCharts.push({ caption, chartId });
    }
    return chartId;
  }

  chartSpecsSnapshot(): Record<string, ChartSpec> {
    return Object.fromEntries(this._chartSpecs);
  }

  /**
   * Assemble the ScoutReportContent. Two failure modes:
   *  - Required set_* calls weren't made → reason:"missing", names them.
   *  - Sections set but the assembled object fails shared-schema validation
   *    (length caps, min lengths, etc.) → reason:"schema", names the
   *    constraint. This is a guardrail: zod limits like .max(15) on
   *    players are not enforced at the per-tool boundary, so a runaway
   *    add_their_player loop would otherwise reach the renderer.
   */
  toContent(): ToContentResult {
    const missing: string[] = [];
    const intro = this._intro;
    const tossDecision = this._tossDecision;
    const overallStrategy = this._overallStrategy;
    const keyMatchups = this._keyMatchups;
    const tactics = this._tactics;
    const conclusion = this._conclusion;
    if (!intro) missing.push("intro");
    if (!tossDecision) missing.push("tossDecision");
    if (!overallStrategy) missing.push("overallStrategy");
    if (!keyMatchups) missing.push("keyMatchups");
    if (!tactics) missing.push("tactics");
    if (!conclusion) missing.push("conclusion");
    if (
      !intro ||
      !tossDecision ||
      !overallStrategy ||
      !keyMatchups ||
      !tactics ||
      !conclusion
    ) {
      return { ok: false, reason: "missing", missing };
    }

    const candidate: ScoutReportContent = {
      intro,
      tossDecision,
      overallStrategy,
      keyMatchups,
      tactics,
      conclusion,
      weather: this._weather,
      leagueTable: this._leagueTable,
      ourPlayers: this._ourPlayers.length > 0 ? this._ourPlayers : undefined,
      theirPlayers:
        this._theirPlayers.length > 0 ? this._theirPlayers : undefined,
      ourPlayersCharts:
        this._ourPlayersCharts.length > 0 ? this._ourPlayersCharts : undefined,
      theirPlayersCharts:
        this._theirPlayersCharts.length > 0
          ? this._theirPlayersCharts
          : undefined,
      // Server-side overrides this from the citation accumulator after the run.
      references: [],
    };

    const parsed = scoutReportContentSchema.safeParse(candidate);
    if (!parsed.success) {
      return { ok: false, reason: "schema", message: parsed.error.message };
    }
    return { ok: true, content: parsed.data };
  }
}

export interface SectionToolDeps {
  accumulator: ReportContentAccumulator;
}

/**
 * Build the section-output tool surface. All tools share one accumulator;
 * each tool's execute is a thin Zod-validated write into it.
 */
export function createSectionTools(deps: SectionToolDeps) {
  const { accumulator } = deps;

  const sectionText = (max: number, hint: string) =>
    z.object({
      text: z.string().min(10).max(max).describe(hint),
    });

  return {
    set_intro: tool({
      description: `Write the report's introduction — 1–2 paragraphs covering scope (which match, format, opposition, why it matters). Appears on the overview (first) page. Markdown bold/italic allowed. Last call wins; refine by calling again with new text.`,
      inputSchema: sectionText(800, "1–2 paragraph intro"),
      // eslint-disable-next-line @typescript-eslint/require-await -- AI SDK execute is async; this writes synchronously.
      execute: async ({ text }) => {
        accumulator.setIntro(text);
        return { saved: "intro" as const };
      },
    }),

    set_toss_decision: tool({
      description: `Write the toss-decision section — 1–3 sentences: bat/bowl call and why (weather, pitch, opposition strengths). Markdown bold/italic allowed. Lives on the Tactics page.`,
      inputSchema: sectionText(800, "1–3 sentences"),
      // eslint-disable-next-line @typescript-eslint/require-await
      execute: async ({ text }) => {
        accumulator.setTossDecision(text);
        return { saved: "tossDecision" as const };
      },
    }),

    set_overall_strategy: tool({
      description: `Write the overall-strategy section — 1–3 sentences on the headline plan for the day. Markdown bold/italic allowed. Lives on the Tactics page.`,
      inputSchema: sectionText(800, "1–3 sentences"),
      // eslint-disable-next-line @typescript-eslint/require-await
      execute: async ({ text }) => {
        accumulator.setOverallStrategy(text);
        return { saved: "overallStrategy" as const };
      },
    }),

    set_key_matchups: tool({
      description: `Write the key-matchups section — bowler-vs-batter and batter-vs-bowler plans, grounded in dismissal patterns / stats / facts. Gets its own page between Their Players and Tactics. Markdown bold/italic allowed; use blank lines for paragraph breaks.`,
      inputSchema: sectionText(4000, "Several short paragraphs"),
      // eslint-disable-next-line @typescript-eslint/require-await
      execute: async ({ text }) => {
        accumulator.setKeyMatchups(text);
        return { saved: "keyMatchups" as const };
      },
    }),

    set_tactics: tool({
      description: `Write the detailed tactics section — batting/bowling order, fielding plans, phase-by-phase plans. Toss decision + overall strategy live in their own fields — keep them out of here. Gets its own page. Markdown bold/italic allowed.`,
      inputSchema: sectionText(4000, "Several short paragraphs"),
      // eslint-disable-next-line @typescript-eslint/require-await
      execute: async ({ text }) => {
        accumulator.setTactics(text);
        return { saved: "tactics" as const };
      },
    }),

    set_conclusion: tool({
      description: `Write the closing section — short, encouraging close. The renderer appends "Up The Main" — do NOT include it.`,
      inputSchema: sectionText(800, "Short close"),
      // eslint-disable-next-line @typescript-eslint/require-await
      execute: async ({ text }) => {
        accumulator.setConclusion(text);
        return { saved: "conclusion" as const };
      },
    }),

    set_weather: tool({
      description: `Record the weather forecast for the match. Call once after weather_get returns; the values come straight from that tool's response. Skip entirely if matchDate is more than 7 days out (forecast unreliable).`,
      inputSchema: weatherInputSchema,
      // eslint-disable-next-line @typescript-eslint/require-await
      execute: async (input) => {
        accumulator.setWeather(input);
        return { saved: "weather" as const };
      },
    }),

    set_league_table: tool({
      description: `Record the structured league table for the division. Call once for league fixtures (competition_type === "League") after pc_league_table returns. Mark our team's row highlight:"us" and the opposition's highlight:"opposition" (omit highlight on others). Skip entirely for cup / friendly fixtures.`,
      inputSchema: scoutLeagueTableSchema,
      // eslint-disable-next-line @typescript-eslint/require-await
      execute: async (input) => {
        accumulator.setLeagueTable(input);
        return { saved: "leagueTable" as const };
      },
    }),

    add_our_player: tool({
      description: `Add a player to the "Our players" section. Call once per player you want listed (max 15). Order = call order. Notes are 1–3 sentences of analyst commentary; stats are headline numbers (max 8 per player).`,
      inputSchema: playerInputSchema,
      // eslint-disable-next-line @typescript-eslint/require-await
      execute: async (input) => {
        accumulator.addOurPlayer(input);
        return { saved: "ourPlayer" as const, name: input.name };
      },
    }),

    add_their_player: tool({
      description: `Add a player to the "Their players" section. Call once per opposition player worth scouting (max 15). Order = call order. Notes describe form / threats / weaknesses; stats are headline numbers (max 8 per player).`,
      inputSchema: playerInputSchema,
      // eslint-disable-next-line @typescript-eslint/require-await
      execute: async (input) => {
        accumulator.addTheirPlayer(input);
        return { saved: "theirPlayer" as const, name: input.name };
      },
    }),

    chart_render: tool({
      description: `Render a Chart.js v4 chart for one of the player sections. The spec is rasterised into a PNG embedded in the PDF; the chart appears in the section you pick (ourPlayers / theirPlayers) under any players you've added there.

Same Chart.js v4 contract as chat mode — bar / line / scatter / bubble / pie / doughnut / radar / polarArea, options.scales / options.plugins / indexAxis / stacked / dual axes / custom colours all work.

Hard rules:
- "data" object must have a "datasets" array; each dataset must have a "data" array. "labels" optional but typical for bar/line/pie.
- No JavaScript functions or callbacks anywhere — JSON-only.
- Total points across all datasets ≤ 1000.
- Don't chart 3 points; don't chart what reads better as a single number.

Returns { chartId } for diagnostics; the chart is already attached to the section, no further wiring required.`,
      inputSchema: z.object({
        chart: chartSpecSchema,
        section: sectionEnum.describe(
          "Which section to attach the chart to: 'ourPlayers' or 'theirPlayers'.",
        ),
        caption: z
          .string()
          .min(1)
          .describe("One-line caption explaining what the chart shows."),
      }),
      // eslint-disable-next-line @typescript-eslint/require-await
      execute: async ({ chart, section, caption }) => {
        const chartId = accumulator.addChart(section, caption, chart);
        const points = chart.data.datasets.reduce(
          (n, ds) => n + ds.data.length,
          0,
        );
        return {
          rendered: true,
          chartId,
          section,
          datasets: chart.data.datasets.length,
          points,
        };
      },
    }),
  };
}

export type SectionTools = ReturnType<typeof createSectionTools>;
