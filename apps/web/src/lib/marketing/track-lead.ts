import {
  campaigns,
  isCampaignId,
  type CampaignId,
} from "@percy-main/shared/marketing";
import { getConsentSnapshot } from "./consent.js";
import { sha256, trackEvent } from "./gtag.js";

const ADS_CONVERSION_ID = import.meta.env.VITE_GOOGLE_ADS_CONVERSION_ID as
  string | undefined;

function resolveConversionLabel(
  campaignId: CampaignId,
  segment: string | null | undefined,
): string | null {
  const generateLead = campaigns[campaignId].conversionActions.generate_lead as
    | (Record<string, { conversionLabel: string }> & {
        _all?: { conversionLabel: string };
      })
    | undefined;
  if (!generateLead) return null;
  if (segment && segment in generateLead) {
    return generateLead[segment]?.conversionLabel ?? null;
  }
  return generateLead._all?.conversionLabel ?? null;
}

/**
 * Fires `generate_lead` to Google Ads after a successful API submission.
 * Enhanced Conversions hashed-email is only attached when the user has
 * granted ad_user_data consent.
 *
 * Safe to call when VITE_GOOGLE_ADS_CONVERSION_ID is unset; the send_to
 * tag is omitted and the event still fires for GA4.
 */
export async function trackLeadGenerated(input: {
  campaignId: string;
  segment: string | null;
  email: string;
}): Promise<void> {
  const { campaignId, segment, email } = input;
  if (!isCampaignId(campaignId)) return;

  const params: Record<string, unknown> = {
    campaign_id: campaignId,
    segment: segment ?? "_unknown",
    value: 0,
    currency: "GBP",
  };

  if (ADS_CONVERSION_ID) {
    const label = resolveConversionLabel(campaignId, segment);
    // Suppress send_to for any placeholder labels still in the registry -
    // real labels land via Phase 4 ticket 003. Without this guard the
    // generate_lead conversion would fire to a non-existent Ads
    // conversion action and pollute the Ads diagnostics with errors.
    if (label && !label.startsWith("PLACEHOLDER_")) {
      params.send_to = `${ADS_CONVERSION_ID}/${label}`;
    }
  }

  if (getConsentSnapshot().ad_user_data === "granted") {
    const hashedEmail = await sha256(email.toLowerCase().trim());
    params.user_data = { email_address: hashedEmail };
  }

  trackEvent("generate_lead", params);
}
