import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

const COLOURS = {
  primary: "#1b3d2f",
  text: "#1f2937",
  muted: "#4b5563",
  rule: "#e5e7eb",
  warn: "#92400e",
  panel: "#f9fafb",
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
  title: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: COLOURS.primary,
    marginBottom: 4,
  },
  summary: {
    marginBottom: 16,
    fontSize: 10,
    color: COLOURS.muted,
  },
  emptyState: {
    fontSize: 11,
    color: COLOURS.muted,
    marginTop: 24,
    textAlign: "center",
  },
  memberBlock: {
    marginBottom: 14,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLOURS.rule,
    borderBottomStyle: "solid",
  },
  memberHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 4,
  },
  memberName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    color: COLOURS.primary,
  },
  memberMeta: {
    fontSize: 9,
    color: COLOURS.muted,
  },
  memberTotal: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: COLOURS.text,
  },
  juniorBadge: {
    fontSize: 8,
    color: COLOURS.warn,
    marginLeft: 6,
  },
  parentLine: {
    fontSize: 9,
    color: COLOURS.muted,
    marginBottom: 4,
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: COLOURS.panel,
    borderTopWidth: 1,
    borderTopColor: COLOURS.rule,
    borderTopStyle: "solid",
    borderBottomWidth: 1,
    borderBottomColor: COLOURS.rule,
    borderBottomStyle: "solid",
  },
  tableHeaderCell: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    paddingVertical: 3,
    paddingHorizontal: 4,
    color: COLOURS.text,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLOURS.rule,
    borderBottomStyle: "solid",
  },
  tableCell: {
    paddingVertical: 3,
    paddingHorizontal: 4,
    fontSize: 9,
  },
  colDate: { width: 70 },
  colDescription: { flex: 1 },
  colSource: { width: 70 },
  colAmount: { width: 60, textAlign: "right" },
  numeric: { textAlign: "right" },
  abandonedTag: {
    fontSize: 8,
    color: COLOURS.warn,
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
  grandTotalRow: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 2,
    borderTopColor: COLOURS.primary,
    borderTopStyle: "solid",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  grandTotalLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    color: COLOURS.primary,
  },
  grandTotalValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    color: COLOURS.primary,
  },
});

export interface UnpaidChargeRow {
  id: string;
  chargeDate: string;
  description: string;
  source: string;
  amountPence: number;
  isAbandoned: boolean;
}

export interface UnpaidChargesMemberGroup {
  memberId: string;
  memberName: string | null;
  memberEmail: string | null;
  memberCategory: string | null;
  paidByParents: Array<{ name: string | null; email: string | null }>;
  totalPence: number;
  charges: UnpaidChargeRow[];
}

export interface UnpaidChargesPdfProps {
  groups: UnpaidChargesMemberGroup[];
  grandTotalPence: number;
  generatedAt: string;
  logoPng: Buffer;
}

function formatPence(p: number): string {
  return `£${(p / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function UnpaidChargesPdf({
  groups,
  grandTotalPence,
  generatedAt,
  logoPng,
}: UnpaidChargesPdfProps) {
  return (
    <Document
      title="Percy Main CSC — Unpaid charges"
      author="Percy Main CSC"
      subject="Outstanding charges report"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <Image src={logoPng} style={styles.headerLogo} />
          <View style={styles.headerTextBlock}>
            <Text style={styles.headerClub}>Percy Main CSC</Text>
            <Text style={styles.headerSubtitle}>Outstanding charges</Text>
          </View>
          <Text style={styles.headerDate}>Generated {generatedAt}</Text>
        </View>

        <Text style={styles.title}>Unpaid charges</Text>
        <Text style={styles.summary}>
          {groups.length} player{groups.length === 1 ? "" : "s"} ·{" "}
          {groups.reduce((acc, g) => acc + g.charges.length, 0)} charge
          {groups.reduce((acc, g) => acc + g.charges.length, 0) === 1
            ? ""
            : "s"}{" "}
          · {formatPence(grandTotalPence)} outstanding
        </Text>

        {groups.length === 0 ? (
          <Text style={styles.emptyState}>No unpaid charges. Nice.</Text>
        ) : (
          <>
            {groups.map((g) => (
              <View key={g.memberId} style={styles.memberBlock} wrap={false}>
                <View style={styles.memberHeader}>
                  <Text style={styles.memberName}>
                    {g.memberName ?? g.memberEmail ?? "Unknown"}
                    {g.memberCategory === "junior" && (
                      <Text style={styles.juniorBadge}> (junior)</Text>
                    )}
                  </Text>
                  <Text style={styles.memberTotal}>
                    {formatPence(g.totalPence)}
                  </Text>
                </View>
                {g.memberEmail && (
                  <Text style={styles.memberMeta}>{g.memberEmail}</Text>
                )}
                {g.paidByParents.length > 0 && (
                  <Text style={styles.parentLine}>
                    Paid by{" "}
                    {g.paidByParents
                      .map((p) =>
                        p.email
                          ? `${p.name ?? p.email} <${p.email}>`
                          : (p.name ?? "Unknown"),
                      )
                      .join(", ")}
                  </Text>
                )}

                <View style={styles.tableHeaderRow}>
                  <Text style={[styles.tableHeaderCell, styles.colDate]}>
                    Date
                  </Text>
                  <Text style={[styles.tableHeaderCell, styles.colDescription]}>
                    Description
                  </Text>
                  <Text style={[styles.tableHeaderCell, styles.colSource]}>
                    Source
                  </Text>
                  <Text
                    style={[
                      styles.tableHeaderCell,
                      styles.colAmount,
                      styles.numeric,
                    ]}
                  >
                    Amount
                  </Text>
                </View>
                {g.charges.map((c) => (
                  <View key={c.id} style={styles.tableRow}>
                    <Text style={[styles.tableCell, styles.colDate]}>
                      {formatDate(c.chargeDate)}
                    </Text>
                    <Text style={[styles.tableCell, styles.colDescription]}>
                      {c.description}
                      {c.isAbandoned && (
                        <Text style={styles.abandonedTag}> (abandoned)</Text>
                      )}
                    </Text>
                    <Text style={[styles.tableCell, styles.colSource]}>
                      {c.source}
                    </Text>
                    <Text
                      style={[
                        styles.tableCell,
                        styles.colAmount,
                        styles.numeric,
                      ]}
                    >
                      {formatPence(c.amountPence)}
                    </Text>
                  </View>
                ))}
              </View>
            ))}

            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>Total outstanding</Text>
              <Text style={styles.grandTotalValue}>
                {formatPence(grandTotalPence)}
              </Text>
            </View>
          </>
        )}

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
