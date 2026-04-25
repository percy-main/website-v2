import type { MarketingEventType } from "./events.ts";

interface ConversionActionEntry {
  resourceName: string;
  conversionLabel: string;
}

type ConversionActionsMap = Partial<
  Record<
    MarketingEventType,
    Record<string, ConversionActionEntry> & { _all?: ConversionActionEntry }
  >
>;

type OutcomeWindows = Partial<Record<MarketingEventType, number>>;

interface CampaignDef {
  readonly displayName: string;
  readonly segments: readonly string[];
  readonly primaryEvent: MarketingEventType;
  readonly conversionActions: ConversionActionsMap;
  readonly outcomeWindowsDays: OutcomeWindows;
  readonly defaultValue: { amount: number; currency: "GBP" };
}

export const campaigns = {
  "recruit-2026": {
    displayName: "Recruit 2026",
    segments: [
      "senior_men_cricket",
      "senior_women_softball_cricket",
      "junior_boys_cricket",
      "junior_girls_dynamos_cricket",
    ],
    primaryEvent: "generate_lead",
    conversionActions: {
      generate_lead: {
        senior_men_cricket: {
          resourceName: "customers/0/conversionActions/1001",
          conversionLabel: "PLACEHOLDER_MEN",
        },
        senior_women_softball_cricket: {
          resourceName: "customers/0/conversionActions/1002",
          conversionLabel: "PLACEHOLDER_WOMEN",
        },
        junior_boys_cricket: {
          resourceName: "customers/0/conversionActions/1003",
          conversionLabel: "PLACEHOLDER_JBOYS",
        },
        junior_girls_dynamos_cricket: {
          resourceName: "customers/0/conversionActions/1004",
          conversionLabel: "PLACEHOLDER_JGIRLS",
        },
      },
      lead_attended_session: {
        _all: {
          resourceName: "customers/0/conversionActions/1005",
          conversionLabel: "PLACEHOLDER_ATTENDED",
        },
      },
      lead_became_member: {
        _all: {
          resourceName: "customers/0/conversionActions/1006",
          conversionLabel: "PLACEHOLDER_MEMBER",
        },
      },
    },
    outcomeWindowsDays: {
      generate_lead: 30,
      lead_attended_session: 60,
      lead_became_member: 60,
    },
    defaultValue: { amount: 0, currency: "GBP" as const },
  },
} as const satisfies Record<string, CampaignDef>;

export type CampaignId = keyof typeof campaigns;

export function isCampaignId(value: string): value is CampaignId {
  return Object.prototype.hasOwnProperty.call(campaigns, value);
}

/**
 * Type-level guard: fails to compile if any configured segment for `C` is
 * missing a `generate_lead` conversion action mapping. Runtime-free; catches
 * PR-time typos before they become silent "skipped upload" bugs.
 */
export type AssertAllSegmentsHavePrimaryAction<C extends CampaignId> =
  (typeof campaigns)[C]["segments"][number] extends keyof NonNullable<
    (typeof campaigns)[C]["conversionActions"][(typeof campaigns)[C]["primaryEvent"]]
  >
    ? true
    : never;

// Compile-time check for recruit-2026. Delete a segment from the map above and
// this line will fail to compile.
type _CheckRecruit2026 = AssertAllSegmentsHavePrimaryAction<"recruit-2026">;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _typeCheck: _CheckRecruit2026 = true;

export function resolveAdsConversionAction(
  campaignId: string,
  eventType: MarketingEventType,
  segment: string | null | undefined,
): ConversionActionEntry | null {
  if (!isCampaignId(campaignId)) return null;
  const campaign = campaigns[campaignId];
  const actions = campaign.conversionActions as ConversionActionsMap;
  const byType = actions[eventType];
  if (!byType) return null;
  if (segment && segment in byType) {
    const entry = (byType as Record<string, ConversionActionEntry>)[segment];
    if (entry) return entry;
  }
  return byType._all ?? null;
}

export function getOutcomeWindowDays(
  campaignId: string,
  eventType: MarketingEventType,
): number | null {
  if (!isCampaignId(campaignId)) return null;
  const windows = campaigns[campaignId].outcomeWindowsDays as OutcomeWindows;
  const days = windows[eventType];
  return days ?? null;
}

/**
 * Google Ads retains click data for offline conversion import for 63 days.
 */
export const ADS_OFFLINE_MAX_DAYS = 63;

export function computeOutcomeCutoffDate(
  campaignId: string,
  eventType: MarketingEventType,
  firstSeenAt: string,
): Date | null {
  const windowDays = getOutcomeWindowDays(campaignId, eventType);
  if (windowDays === null) return null;
  const effectiveDays = Math.min(windowDays, ADS_OFFLINE_MAX_DAYS);
  const base = new Date(firstSeenAt);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + effectiveDays * 24 * 60 * 60 * 1000);
}
