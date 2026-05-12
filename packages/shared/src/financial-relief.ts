import { z } from "zod";

export const REASON_CATEGORIES = [
  "cost_of_living",
  "low_income",
  "temporary_change",
  "multiple_family",
  "unemployment",
  "caring",
  "other_personal",
  "prefer_not_to_say",
] as const;

export const REASON_CATEGORY_LABELS: Record<
  (typeof REASON_CATEGORIES)[number],
  string
> = {
  cost_of_living: "Cost of living pressures",
  low_income: "Low household income",
  temporary_change: "Temporary change in circumstances",
  multiple_family: "Multiple family members taking part",
  unemployment: "Unemployment or reduced hours",
  caring: "Caring responsibilities",
  other_personal: "Other personal circumstances",
  prefer_not_to_say: "Prefer not to say",
};

export const reasonCategorySchema = z.enum(REASON_CATEGORIES);
export type ReasonCategory = z.infer<typeof reasonCategorySchema>;

export const DURATIONS = [
  "one_off",
  "one_to_three_months",
  "season",
  "unsure",
  "other",
] as const;

export const DURATION_LABELS: Record<(typeof DURATIONS)[number], string> = {
  one_off: "One-off support",
  one_to_three_months: "1–3 months",
  season: "This season",
  unsure: "Unsure",
  other: "Other",
};

export const durationSchema = z.enum(DURATIONS);
export type Duration = z.infer<typeof durationSchema>;

export const CONTRIBUTION_ABILITIES = [
  "yes_reduced",
  "not_currently",
  "unsure",
] as const;

export const CONTRIBUTION_ABILITY_LABELS: Record<
  (typeof CONTRIBUTION_ABILITIES)[number],
  string
> = {
  yes_reduced: "Yes — I/we can pay a reduced amount",
  not_currently: "Not currently",
  unsure: "Unsure / would like to discuss",
};

export const contributionAbilitySchema = z.enum(CONTRIBUTION_ABILITIES);
export type ContributionAbility = z.infer<typeof contributionAbilitySchema>;

export const VOLUNTEER_OPTIONS = [
  "ground_work",
  "scoring",
  "umpiring",
  "junior_sessions",
  "womens_girls",
  "bbq_kitchen",
  "fundraising",
  "social_media",
  "admin",
  "matchday_setup",
  "transport",
  "other",
  "none",
] as const;

export const VOLUNTEER_OPTION_LABELS: Record<
  (typeof VOLUNTEER_OPTIONS)[number],
  string
> = {
  ground_work: "Ground work / maintenance days",
  scoring: "Scoring",
  umpiring: "Umpiring",
  junior_sessions: "Coaching or helping at junior sessions",
  womens_girls: "Helping with women's/girls' sessions",
  bbq_kitchen: "Barbecue / kitchen / refreshments",
  fundraising: "Fundraising events",
  social_media: "Social media / photography / match reports",
  admin: "Admin support",
  matchday_setup: "Matchday setup or tidy-up",
  transport: "Transport support",
  other: "Other",
  none: "I/we cannot commit to volunteering at the moment",
};

export const volunteerOptionSchema = z.enum(VOLUNTEER_OPTIONS);
export type VolunteerOption = z.infer<typeof volunteerOptionSchema>;

export const CONTACT_PREFERENCES = [
  "none",
  "email",
  "phone",
  "in_person",
] as const;

export const CONTACT_PREFERENCE_LABELS: Record<
  (typeof CONTACT_PREFERENCES)[number],
  string
> = {
  none: "No, please decide based on this form",
  email: "Yes, by email",
  phone: "Yes, by phone",
  in_person: "Yes, in person",
};

export const contactPreferenceSchema = z.enum(CONTACT_PREFERENCES);
export type ContactPreference = z.infer<typeof contactPreferenceSchema>;

export const REQUEST_STATUSES = [
  "submitted",
  "in_review",
  "more_info_needed",
  "approved",
  "declined",
  "withdrawn",
  "expired",
] as const;

export const REQUEST_STATUS_LABELS: Record<
  (typeof REQUEST_STATUSES)[number],
  string
> = {
  submitted: "Submitted",
  in_review: "In review",
  more_info_needed: "More information needed",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

export const requestStatusSchema = z.enum(REQUEST_STATUSES);
export type RequestStatus = z.infer<typeof requestStatusSchema>;

export const GRANT_DECISIONS = [
  "approved_full",
  "approved_partial",
  "approved_temporary",
] as const;

export const GRANT_DECISION_LABELS: Record<
  (typeof GRANT_DECISIONS)[number],
  string
> = {
  approved_full: "Approved — full relief",
  approved_partial: "Approved — partial relief",
  approved_temporary: "Approved — temporary relief",
};

export const grantDecisionSchema = z.enum(GRANT_DECISIONS);
export type GrantDecision = z.infer<typeof grantDecisionSchema>;
