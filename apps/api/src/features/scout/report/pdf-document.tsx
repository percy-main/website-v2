import {
  scoutReportDisplayTitle,
  type ScoutReportChart,
  type ScoutReportPayload,
  type ScoutReportPlayer,
  type ScoutReportReference,
} from "@percy-main/shared";
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import React from "react";

// FE-anchored palette — sourced from apps/web/src/app.css `@theme` tokens.
// Keeping the PDF visually grounded in the same colours the website uses.
const COLOURS = {
  primary: "#1b3d2f", // --color-primary (club green)
  primaryLight: "#2d4a3e", // --color-primary-light
  cta: "#c2410c", // --color-cta (orange)
  text: "#1f2937",
  muted: "#4b5563",
  rule: "#e5e7eb", // --color-border
  panel: "#f9fafb", // --color-surface-raised
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontSize: 10,
    color: COLOURS.text,
    fontFamily: "Helvetica",
    lineHeight: 1.4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 8,
    marginBottom: 18,
    borderBottomWidth: 2,
    borderBottomColor: COLOURS.primary,
    borderBottomStyle: "solid",
  },
  headerLogo: {
    width: 40,
    height: 40,
    marginRight: 12,
  },
  headerTextBlock: {
    flexDirection: "column",
    flexGrow: 1,
  },
  headerClub: {
    fontSize: 12,
    color: COLOURS.primary,
    fontFamily: "Helvetica-Bold",
  },
  headerSubtitle: {
    fontSize: 8,
    color: COLOURS.muted,
    marginTop: 1,
  },
  headerDate: {
    fontSize: 8,
    color: COLOURS.muted,
    textAlign: "right",
  },
  titleBlock: {
    marginBottom: 18,
  },
  titleMatch: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: COLOURS.primary,
    lineHeight: 1.2,
  },
  titleDate: {
    fontSize: 12,
    fontFamily: "Helvetica",
    color: COLOURS.muted,
    marginTop: 4,
  },
  pageHeading: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: COLOURS.primary,
    marginBottom: 12,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLOURS.primary,
    borderBottomStyle: "solid",
  },
  sectionHeading: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: COLOURS.primary,
    marginTop: 14,
    marginBottom: 6,
    paddingBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: COLOURS.rule,
    borderBottomStyle: "solid",
  },
  bodyParagraph: {
    marginBottom: 6,
  },
  weatherPanel: {
    backgroundColor: COLOURS.panel,
    padding: 8,
    borderRadius: 3,
    borderLeftWidth: 3,
    borderLeftColor: COLOURS.primary,
    borderLeftStyle: "solid",
  },
  weatherSummary: {
    marginBottom: 4,
  },
  weatherMeta: {
    fontSize: 8,
    color: COLOURS.muted,
  },
  playerCard: {
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLOURS.rule,
    borderBottomStyle: "solid",
  },
  playerCardLast: {
    marginBottom: 8,
  },
  playerHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 2,
  },
  playerName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: COLOURS.primary,
  },
  playerRole: {
    fontSize: 9,
    color: COLOURS.muted,
  },
  playerNotes: {
    marginBottom: 4,
  },
  statRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  statBlock: {
    marginRight: 12,
    marginBottom: 2,
    fontSize: 9,
  },
  statLabel: {
    color: COLOURS.muted,
  },
  statValue: {
    fontFamily: "Helvetica-Bold",
  },
  chartBlock: {
    marginVertical: 8,
  },
  chartImage: {
    width: "100%",
    height: 180,
    objectFit: "contain",
  },
  chartCaption: {
    fontSize: 8,
    color: COLOURS.muted,
    textAlign: "center",
    marginTop: 2,
  },
  signOff: {
    marginTop: 14,
    fontFamily: "Helvetica-Bold",
    color: COLOURS.cta,
    fontSize: 14,
  },
  refRow: {
    flexDirection: "row",
    marginBottom: 4,
    fontSize: 9,
  },
  refIndex: {
    width: 22,
    color: COLOURS.muted,
  },
  refLabel: {
    fontFamily: "Helvetica-Bold",
    marginRight: 4,
  },
  refUrl: {
    color: COLOURS.primary,
    flexShrink: 1,
  },
  pageNumber: {
    position: "absolute",
    bottom: 24,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 8,
    color: COLOURS.muted,
  },
});

interface ChartImageSource {
  /** Stable id matching the chart's array index in its section. */
  id: string;
  /** Raw PNG buffer to embed. */
  png: Buffer;
}

export interface ScoutReportPdfProps {
  payload: ScoutReportPayload;
  /** PNGs for ourPlayersCharts, indexed by array position. */
  ourCharts: ChartImageSource[];
  /** PNGs for theirPlayersCharts, indexed by array position. */
  theirCharts: ChartImageSource[];
  /** PNG buffer of the club logo to render in the header. */
  logoPng: Buffer;
  /** Render-time stamp shown in the header (ISO-ish, formatted by caller). */
  generatedAt: string;
}

export function ScoutReportPdf({
  payload,
  ourCharts,
  theirCharts,
  logoPng,
  generatedAt,
}: ScoutReportPdfProps) {
  const hasOurPlayers = (payload.ourPlayers ?? []).length > 0;
  const hasTheirPlayers = (payload.theirPlayers ?? []).length > 0;

  return (
    <Document
      title={scoutReportDisplayTitle(payload)}
      author="Percy Main CSC — Scout"
      subject="Scouting report"
    >
      {/* Page 1 — Overview */}
      <ReportPage logoPng={logoPng} generatedAt={generatedAt}>
        <View style={styles.titleBlock}>
          <Text style={styles.titleMatch}>{payload.match}</Text>
          <Text style={styles.titleDate}>{payload.matchDate}</Text>
        </View>

        <Section heading="Introduction">
          <Paragraph text={payload.intro} />
        </Section>

        {payload.weather ? (
          <Section heading="Weather">
            <View style={styles.weatherPanel}>
              <Text style={styles.weatherSummary}>
                {payload.weather.summary}
              </Text>
              <Text style={styles.weatherMeta}>
                Forecast retrieved {payload.weather.retrievedAt}
                {payload.weather.source ? ` · ${payload.weather.source}` : ""}
              </Text>
            </View>
          </Section>
        ) : null}

        <Section heading="Toss decision">
          <Paragraph text={payload.tossDecision} />
        </Section>

        <Section heading="Overall strategy">
          <Paragraph text={payload.overallStrategy} />
        </Section>
      </ReportPage>

      {hasOurPlayers ? (
        <ReportPage logoPng={logoPng} generatedAt={generatedAt}>
          <Text style={styles.pageHeading}>Our players</Text>
          <PlayerList
            players={payload.ourPlayers ?? []}
            charts={payload.ourPlayersCharts}
            chartImages={ourCharts}
          />
        </ReportPage>
      ) : null}

      {hasTheirPlayers ? (
        <ReportPage logoPng={logoPng} generatedAt={generatedAt}>
          <Text style={styles.pageHeading}>Their players</Text>
          <PlayerList
            players={payload.theirPlayers ?? []}
            charts={payload.theirPlayersCharts}
            chartImages={theirCharts}
          />
        </ReportPage>
      ) : null}

      <ReportPage logoPng={logoPng} generatedAt={generatedAt}>
        <Text style={styles.pageHeading}>Key matchups</Text>
        <Paragraph text={payload.keyMatchups} />
      </ReportPage>

      <ReportPage logoPng={logoPng} generatedAt={generatedAt}>
        <Text style={styles.pageHeading}>Tactics</Text>
        <Paragraph text={payload.tactics} />
      </ReportPage>

      <ReportPage logoPng={logoPng} generatedAt={generatedAt}>
        <Text style={styles.pageHeading}>Conclusion</Text>
        <Paragraph text={payload.conclusion} />
        <Text style={styles.signOff}>Up The Main</Text>
      </ReportPage>

      {payload.references.length > 0 ? (
        <ReportPage logoPng={logoPng} generatedAt={generatedAt}>
          <Text style={styles.pageHeading}>References</Text>
          {payload.references.map((ref, i) => (
            <ReferenceRow key={i} index={i + 1} reference={ref} />
          ))}
        </ReportPage>
      ) : null}
    </Document>
  );
}

function ReportPage({
  logoPng,
  generatedAt,
  children,
}: {
  logoPng: Buffer;
  generatedAt: string;
  children: React.ReactNode;
}) {
  return (
    <Page size="A4" style={styles.page}>
      <Header logoPng={logoPng} generatedAt={generatedAt} />
      {children}
      <Text
        style={styles.pageNumber}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
        fixed
      />
    </Page>
  );
}

function Header({
  logoPng,
  generatedAt,
}: {
  logoPng: Buffer;
  generatedAt: string;
}) {
  return (
    <View style={styles.header} fixed>
      <Image style={styles.headerLogo} src={logoPng} />
      <View style={styles.headerTextBlock}>
        <Text style={styles.headerClub}>Percy Main Community Sports Club</Text>
        <Text style={styles.headerSubtitle}>Scouting report</Text>
      </View>
      <Text style={styles.headerDate}>Generated {generatedAt}</Text>
    </View>
  );
}

function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <Text style={styles.sectionHeading}>{heading}</Text>
      {children}
    </View>
  );
}

function Paragraph({ text }: { text: string }) {
  // Split on blank lines so the model can use paragraph breaks naturally.
  // Inline markdown is handled inside InlineMarkdown — bold and italic only.
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  return (
    <View>
      {paragraphs.map((p, i) => (
        <Text key={i} style={styles.bodyParagraph}>
          <InlineMarkdown text={p.trim()} />
        </Text>
      ))}
    </View>
  );
}

type InlineRun = {
  text: string;
  bold: boolean;
  italic: boolean;
};

// Tiny inline-markdown tokenizer: handles **bold** and _italic_ (and the two
// nested either way). Anything else passes through as plain text. Deliberately
// simple — the structural sections do the heavy lifting; this just rescues
// emphasis the model emits inside paragraphs.
function tokenizeInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let i = 0;
  let bold = false;
  let italic = false;
  let buf = "";
  const flush = () => {
    if (buf.length > 0) {
      runs.push({ text: buf, bold, italic });
      buf = "";
    }
  };
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      flush();
      bold = !bold;
      i += 2;
      continue;
    }
    if (text[i] === "_") {
      flush();
      italic = !italic;
      i += 1;
      continue;
    }
    buf += text[i];
    i += 1;
  }
  flush();
  return runs;
}

function fontFamilyFor(bold: boolean, italic: boolean): string {
  if (bold && italic) return "Helvetica-BoldOblique";
  if (bold) return "Helvetica-Bold";
  if (italic) return "Helvetica-Oblique";
  return "Helvetica";
}

function InlineMarkdown({ text }: { text: string }) {
  const runs = tokenizeInline(text);
  return (
    <>
      {runs.map((run, i) => (
        <Text
          key={i}
          style={{ fontFamily: fontFamilyFor(run.bold, run.italic) }}
        >
          {run.text}
        </Text>
      ))}
    </>
  );
}

function PlayerList({
  players,
  charts,
  chartImages,
}: {
  players: ScoutReportPlayer[];
  charts: ScoutReportChart[] | undefined;
  chartImages: ChartImageSource[];
}) {
  return (
    <>
      {players.map((p, i) => (
        <PlayerCard
          key={i}
          player={p}
          last={i === players.length - 1 && (!charts || charts.length === 0)}
        />
      ))}
      {charts?.map((c, i) => {
        const image = chartImages.find((img) => img.id === String(i));
        if (!image) return null;
        return (
          <View key={i} style={styles.chartBlock} wrap={false}>
            <Image style={styles.chartImage} src={image.png} />
            <Text style={styles.chartCaption}>{c.caption}</Text>
          </View>
        );
      })}
    </>
  );
}

function PlayerCard({
  player,
  last,
}: {
  player: ScoutReportPlayer;
  last: boolean;
}) {
  return (
    <View style={last ? styles.playerCardLast : styles.playerCard} wrap={false}>
      <View style={styles.playerHeaderRow}>
        <Text style={styles.playerName}>{player.name}</Text>
        {player.role ? (
          <Text style={styles.playerRole}>{player.role}</Text>
        ) : null}
      </View>
      {player.notes ? (
        <Text style={styles.playerNotes}>
          <InlineMarkdown text={player.notes} />
        </Text>
      ) : null}
      {player.stats && player.stats.length > 0 ? (
        <View style={styles.statRow}>
          {player.stats.map((s, i) => (
            <Text key={i} style={styles.statBlock}>
              <Text style={styles.statLabel}>{s.label}: </Text>
              <Text style={styles.statValue}>{s.value}</Text>
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ReferenceRow({
  index,
  reference,
}: {
  index: number;
  reference: ScoutReportReference;
}) {
  return (
    <View style={styles.refRow} wrap={false}>
      <Text style={styles.refIndex}>[{index}]</Text>
      <Text style={styles.refLabel}>{reference.label}</Text>
      <Text style={styles.refUrl}>{reference.url}</Text>
    </View>
  );
}
