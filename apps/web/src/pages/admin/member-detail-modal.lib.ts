// ---------------------------------------------------------------------------
// Pure formatting / aggregation helpers extracted from member-detail-modal.tsx
// for unit testing. No React, no react-query, no DOM dependencies.
// ---------------------------------------------------------------------------

import type { paths } from "@/lib/api.gen";
import { formatDate } from "./status-pill";

type UserDetail =
  paths["/api/admin/users/{userId}"]["get"]["responses"]["200"]["content"]["application/json"];

export type Member = UserDetail["member"];
export type Dependent = UserDetail["dependents"][number];
export type Charge = UserDetail["charges"][number];

export interface DisplayField {
  label: string;
  value: string | null;
}

/**
 * Display label for a dependent's `sex` field. Returns null when sex is
 * unset, and humanises the special "prefer_not_to_say" value.
 */
export function formatSex(sex: string | null): string | null {
  if (!sex) return null;
  if (sex === "prefer_not_to_say") return "Prefer not to say";
  return sex.charAt(0).toUpperCase() + sex.slice(1);
}

/**
 * Format a yes/no consent boolean, returning null for unset (NULL) values.
 * Mirrors the inline ternaries used in the dependent card.
 */
export function formatConsent(value: boolean | null): string | null {
  if (value === null) return null;
  return value ? "Yes" : "No";
}

/**
 * Combine two free-text fields with " / ", filtering out blanks.
 * Returns null if both are empty (so the field is omitted entirely).
 */
export function joinPair(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  return [a, b].filter(Boolean).join(" / ") || null;
}

/**
 * Build the static "Member Details" field list shown for a member record.
 * Returns a stable list of {label, value} pairs the React layer maps over.
 */
export function buildMemberDetailFields(
  member: NonNullable<Member>,
): DisplayField[] {
  return [
    { label: "Title", value: member.title },
    { label: "Name", value: member.name },
    { label: "Address", value: member.address },
    { label: "Postcode", value: member.postcode },
    {
      label: "Date of Birth",
      value: member.dob ? formatDate(member.dob) : null,
    },
    { label: "Telephone", value: member.telephone },
    { label: "Emergency Contact", value: member.emergency_contact_name },
    {
      label: "Emergency Telephone",
      value: member.emergency_contact_telephone,
    },
  ];
}

/**
 * Build the field list shown in a junior (dependent) detail card.
 * Fields with a `null` value are filtered out at the render layer.
 */
export function buildDependentFields(dependent: Dependent): DisplayField[] {
  return [
    {
      label: "Date of Birth",
      value: dependent.dob ? formatDate(dependent.dob) : null,
    },
    { label: "Sex", value: formatSex(dependent.sex) },
    { label: "School Year", value: dependent.school_year },
    {
      label: "Photo Consent",
      value: formatConsent(dependent.photo_consent),
    },
    {
      label: "GP Surgery / Phone",
      value: joinPair(dependent.gp_surgery, dependent.gp_phone),
    },
    {
      label: "Alt Contact",
      value: joinPair(dependent.alt_contact_name, dependent.alt_contact_phone),
    },
    {
      label: "Emergency Medical Consent",
      value: formatConsent(dependent.emergency_medical_consent),
    },
    {
      label: "Disability",
      value: dependent.has_disability
        ? (dependent.disability_type ?? "Yes")
        : null,
    },
  ];
}

export type ChargeStatus = "paid" | "pending" | "unpaid";

export interface ChargeStatusDisplay {
  label: string;
  variant: "green" | "blue" | "yellow";
  status: ChargeStatus;
}

/**
 * Resolve a charge's status pill from its paid_at / payment_confirmed_at
 * timestamps. Order of precedence:
 *   1. paid_at  → Paid (green)
 *   2. payment_confirmed_at → Pending (blue)
 *   3. otherwise → Unpaid (yellow)
 */
export function getChargeStatus(charge: Charge): ChargeStatusDisplay {
  if (charge.paid_at) {
    return { label: "Paid", variant: "green", status: "paid" };
  }
  if (charge.payment_confirmed_at) {
    return { label: "Pending", variant: "blue", status: "pending" };
  }
  return { label: "Unpaid", variant: "yellow", status: "unpaid" };
}

/**
 * Charges are deletable only while still unpaid (no paid_at, no payment
 * confirmation). Once a payment has been recorded, deletion is gated on the
 * server side as well; this is the UI's mirror of that rule.
 */
export function canDeleteCharge(charge: Charge): boolean {
  return !charge.paid_at && !charge.payment_confirmed_at;
}

export interface ChargesBreakdown {
  total: number;
  paid: number;
  pending: number;
  unpaid: number;
  totalPence: number;
  unpaidPence: number;
}

/**
 * Aggregate counts and pence totals for a list of charges.
 */
export function summariseCharges(charges: readonly Charge[]): ChargesBreakdown {
  let paid = 0;
  let pending = 0;
  let unpaid = 0;
  let totalPence = 0;
  let unpaidPence = 0;

  for (const c of charges) {
    totalPence += c.amount_pence;
    const status = getChargeStatus(c).status;
    if (status === "paid") paid++;
    else if (status === "pending") pending++;
    else {
      unpaid++;
      unpaidPence += c.amount_pence;
    }
  }

  return {
    total: charges.length,
    paid,
    pending,
    unpaid,
    totalPence,
    unpaidPence,
  };
}

/**
 * True when the member record is soft-deleted (deleted_at set).
 * Centralises the null/undefined check used across sections.
 */
export function isMemberArchived(member: Member): boolean {
  return Boolean(member?.deleted_at);
}

export interface NewChargeInput {
  description: string;
  amount: string;
  chargeDate: string;
}

export type ParsedChargeForm =
  | { ok: false }
  | {
      ok: true;
      description: string;
      amountPence: number;
      chargeDate: string;
    };

/**
 * Validate and parse the new-charge form fields. Returns `ok: false` for
 * empty descriptions or amounts that aren't strictly positive (>= 1p),
 * matching the original form-submit guard.
 */
export function parseNewChargeForm(input: NewChargeInput): ParsedChargeForm {
  const description = input.description.trim();
  const amountNum = parseFloat(input.amount);
  if (!description) return { ok: false };
  if (Number.isNaN(amountNum) || amountNum < 0.01) return { ok: false };
  return {
    ok: true,
    description,
    amountPence: Math.round(amountNum * 100),
    chargeDate: input.chargeDate,
  };
}

import {
  ROLE_LABELS,
  parseRoles,
  type RoleName,
} from "@percy-main/shared/auth/permissions";

/**
 * Display label for a single user role (or first of a comma-separated list).
 * Falls back to "User" for unknown roles or no role.
 */
export function getRoleLabel(role: string | null | undefined): string {
  const parsed = parseRoles(role);
  if (parsed.length === 0) return "User";
  return ROLE_LABELS[parsed[0]];
}

/** Display labels for every role in a comma-separated role string. */
export function getRoleLabels(
  role: string | null | undefined,
): Array<{ name: RoleName; label: string }> {
  return parseRoles(role).map((name) => ({ name, label: ROLE_LABELS[name] }));
}
