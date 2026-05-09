/**
 * Pure helpers for the marketing lead form.
 *
 * Extracted so they can be unit-tested without React/DOM. The form component
 * still owns state + react-query plumbing; everything here is pure.
 *
 * Types are generic over the API-generated payload shape — the API layer
 * supplies `Consent` and `Attribution` types so this lib stays decoupled
 * from the OpenAPI spec.
 */

export type LeadVariant = "adult" | "junior";

export interface AdultFormData {
  name: string;
  email: string;
  phone: string;
  notes: string;
  honeypot: string;
}

export interface JuniorFormData {
  childName: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  notes: string;
  honeypot: string;
}

export interface BuildLeadPayloadInput<TConsent, TAttribution> {
  campaignId: string;
  segment: string;
  variant: LeadVariant;
  adult: AdultFormData;
  junior: JuniorFormData;
  attribution?: TAttribution;
  consent: TConsent;
}

export interface LeadPayload<TConsent, TAttribution> {
  campaignId: string;
  segment: string;
  name: string;
  email: string;
  phone?: string;
  source: "landing-junior" | "landing-adult";
  fields?: Record<string, unknown>;
  attribution?: TAttribution;
  consent: TConsent;
  honeypot?: string;
}

/**
 * Trims a string and returns it.
 */
export function safeTrim(value: string): string {
  return value.trim();
}

/**
 * Trims a string and returns undefined when empty — keeps optional fields
 * out of the payload entirely (per "use NULL/undefined, not empty string").
 */
export function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Lightweight email shape check — defers to the server for authoritative
 * validation, but blocks obvious typos client-side so the submit button
 * isn't enabled when an email is clearly malformed.
 */
export function safeEmail(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  // Minimal: a single "@" with non-empty parts on each side, and at least
  // one "." in the domain segment.
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0 || atIndex !== trimmed.lastIndexOf("@")) return undefined;
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (local.length === 0 || domain.length === 0) return undefined;
  if (!domain.includes(".")) return undefined;
  if (domain.startsWith(".") || domain.endsWith(".")) return undefined;
  return trimmed;
}

/**
 * Phone normalisation — strips formatting characters that users commonly
 * paste in (spaces, dashes, parens) but keeps a leading "+" for E.164-ish
 * inputs. Returns undefined for empty/whitespace-only input.
 */
export function normalisePhone(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length === 0) return undefined;
  return hasLeadingPlus ? `+${digits}` : digits;
}

/**
 * Returns true when the form has the required fields filled in well enough
 * to attempt a submit. Honeypot is allowed to be non-empty here — the
 * server rejects honeypot hits regardless.
 */
export function isLeadFormReady(input: {
  variant: LeadVariant;
  adult: AdultFormData;
  junior: JuniorFormData;
}): boolean {
  if (input.variant === "junior") {
    const j = input.junior;
    return (
      safeTrim(j.childName).length > 0 &&
      safeTrim(j.parentName).length > 0 &&
      safeEmail(j.parentEmail) !== undefined
    );
  }
  const a = input.adult;
  return safeTrim(a.name).length > 0 && safeEmail(a.email) !== undefined;
}

/**
 * Builds the request body for POST /api/marketing/leads from form state.
 * Pure: no I/O, no DOM, no react-query.
 */
export function buildLeadPayload<TConsent, TAttribution>(
  input: BuildLeadPayloadInput<TConsent, TAttribution>,
): LeadPayload<TConsent, TAttribution> {
  const {
    campaignId,
    segment,
    variant,
    adult,
    junior,
    attribution,
    consent,
  } = input;
  const isJunior = variant === "junior";

  const name = isJunior ? safeTrim(junior.parentName) : safeTrim(adult.name);
  const email = isJunior
    ? safeTrim(junior.parentEmail)
    : safeTrim(adult.email);
  const phone = isJunior
    ? normalisePhone(junior.parentPhone)
    : normalisePhone(adult.phone);
  const notes = isJunior
    ? emptyToUndefined(junior.notes)
    : emptyToUndefined(adult.notes);
  const honeypot = isJunior ? junior.honeypot : adult.honeypot;

  const fields: Record<string, unknown> = {};
  if (notes !== undefined) fields.notes = notes;
  if (isJunior) {
    const childName = safeTrim(junior.childName);
    if (childName.length > 0) fields.child_name = childName;
  }

  const payload: LeadPayload<TConsent, TAttribution> = {
    campaignId,
    segment,
    name,
    email,
    source: isJunior ? "landing-junior" : "landing-adult",
    consent,
  };
  if (phone !== undefined) payload.phone = phone;
  if (Object.keys(fields).length > 0) payload.fields = fields;
  if (attribution !== undefined) payload.attribution = attribution;
  if (honeypot.length > 0) payload.honeypot = honeypot;

  return payload;
}
