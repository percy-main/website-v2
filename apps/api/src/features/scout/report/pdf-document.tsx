import type {
  ScoutReportChart,
  ScoutReportPayload,
  ScoutReportPlayer,
  ScoutReportReference,
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

// Layout constants. The default Helvetica is bundled with the PDF spec so
// no font registration is needed — keeps the renderer hermetic.
const COLOURS = {
  navy: "#1E3A8C",
  red: "#C94434",
  text: "#1F2937",
  muted: "#4B5563",
  rule: "#D1D5DB",
  panel: "#F3F4F6",
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
    marginBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: COLOURS.navy,
    borderBottomStyle: "solid",
  },
  headerLogo: {
    width: 48,
    height: 48,
    marginRight: 12,
  },
  headerTextBlock: {
    flexDirection: "column",
    flexGrow: 1,
  },
  headerClub: {
    fontSize: 14,
    color: COLOURS.navy,
    fontFamily: "Helvetica-Bold",
  },
  headerSubtitle: {
    fontSize: 9,
    color: COLOURS.muted,
  },
  headerDate: {
    fontSize: 9,
    color: COLOURS.muted,
    textAlign: "right",
  },
  title: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: COLOURS.navy,
    marginBottom: 12,
  },
  sectionHeading: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: COLOURS.navy,
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
    marginTop: 10,
    fontFamily: "Helvetica-Bold",
    color: COLOURS.red,
    fontSize: 12,
  },
  refRow: {
    flexDirection: "row",
    marginBottom: 2,
    fontSize: 8,
  },
  refIndex: {
    width: 18,
    color: COLOURS.muted,
  },
  refLabel: {
    fontFamily: "Helvetica-Bold",
    marginRight: 4,
  },
  refUrl: {
    color: COLOURS.navy,
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
  return (
    <Document
      title={payload.title}
      author="Percy Main CSC — Scout"
      subject="Scouting report"
    >
      <Page size="A4" style={styles.page}>
        <Header logoPng={logoPng} generatedAt={generatedAt} />
        <Text style={styles.title}>{payload.title}</Text>

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

        {payload.ourPlayers && payload.ourPlayers.length > 0 ? (
          <PlayerSection
            heading="Our players"
            players={payload.ourPlayers}
            charts={payload.ourPlayersCharts}
            chartImages={ourCharts}
          />
        ) : null}

        {payload.theirPlayers && payload.theirPlayers.length > 0 ? (
          <PlayerSection
            heading="Their players"
            players={payload.theirPlayers}
            charts={payload.theirPlayersCharts}
            chartImages={theirCharts}
          />
        ) : null}

        <Section heading="Tactics">
          <Paragraph text={payload.tactics} />
        </Section>

        <Section heading="Conclusion">
          <Paragraph text={payload.conclusion} />
          <Text style={styles.signOff}>Up The Main</Text>
        </Section>

        {payload.references.length > 0 ? (
          <Section heading="References">
            {payload.references.map((ref, i) => (
              <ReferenceRow key={i} index={i + 1} reference={ref} />
            ))}
          </Section>
        ) : null}

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} / ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
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
  // We don't render full markdown — this PDF is structured by sections, not
  // by inline formatting.
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  return (
    <View>
      {paragraphs.map((p, i) => (
        <Text key={i} style={styles.bodyParagraph}>
          {p.trim()}
        </Text>
      ))}
    </View>
  );
}

function PlayerSection({
  heading,
  players,
  charts,
  chartImages,
}: {
  heading: string;
  players: ScoutReportPlayer[];
  charts: ScoutReportChart[] | undefined;
  chartImages: ChartImageSource[];
}) {
  return (
    <Section heading={heading}>
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
    </Section>
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
        <Text style={styles.playerNotes}>{player.notes}</Text>
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
