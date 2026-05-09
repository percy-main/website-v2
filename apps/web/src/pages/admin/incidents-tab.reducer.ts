/**
 * State + reducer for the "Edit incident" admin form.
 *
 * Pure helpers and reducer only — no React imports — so the logic
 * (date conversion, payload building, mapping the tri-state RIDDOR
 * select) can be unit-tested without a renderer.
 *
 * The list view's filter / pagination state is intentionally NOT
 * modelled here: it lives in the outer `IncidentsTab` component and
 * has nothing to do with this form.
 */

export type IncidentStatus = "new" | "in_review" | "done";
export type IncidentSeverity = "low" | "medium" | "high";
export type IncidentRiddorState = "unset" | "yes" | "no";

/**
 * Subset of an incident-report record that this form's initial state
 * is hydrated from. Defined locally rather than imported from the
 * generated API types so the reducer file stays standalone and easy
 * to test.
 */
export interface IncidentInitial {
  status: IncidentStatus;
  severity: IncidentSeverity | null;
  internalNotes: string | null;
  actionsTaken: string | null;
  targetCompletionDate: string | null;
  riddorRequired: boolean | null;
  riddorReportedAt: string | null;
  closureReason: string | null;
  closedAt: string | null;
  safeguardingDiscussed: boolean;
  safeguardingDiscussedAt: string | null;
  safeguardingNotes: string | null;
}

export interface IncidentEditFormState {
  status: IncidentStatus;
  severity: IncidentSeverity | "unset";
  internalNotes: string;
  actionsTaken: string;
  targetCompletionDate: string; // yyyy-mm-dd
  riddorRequired: IncidentRiddorState;
  riddorReportedAt: string; // yyyy-mm-dd
  closureReason: string;
  closedAt: string; // datetime-local
  safeguardingDiscussed: boolean;
  safeguardingDiscussedAt: string; // datetime-local
  safeguardingNotes: string;
}

/**
 * Format an ISO timestamp as a `<input type="datetime-local">` value
 * (yyyy-mm-ddThh:mm) in the local timezone. Returns "" for null /
 * undefined / unparseable input.
 */
export function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Inverse of `toDateTimeLocal`: parse a local datetime string back to
 * an ISO timestamp, or null if blank / unparseable.
 */
export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Format an ISO timestamp as a `<input type="date">` value (yyyy-mm-dd)
 * in the local timezone. Returns "" for null / undefined / unparseable.
 */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Inverse of `toDateInput`: parse a date-input string back to an ISO
 * timestamp at midnight local time, or null if blank / unparseable.
 */
export function fromDateInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function riddorFromBool(value: boolean | null): IncidentRiddorState {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unset";
}

/**
 * Hydrate the form state from an incident-report record loaded from
 * the API. Pure: equivalent inputs always produce equal output.
 */
export function initialIncidentEditState(
  initial: IncidentInitial,
): IncidentEditFormState {
  return {
    status: initial.status,
    severity: initial.severity ?? "unset",
    internalNotes: initial.internalNotes ?? "",
    actionsTaken: initial.actionsTaken ?? "",
    targetCompletionDate: toDateInput(initial.targetCompletionDate),
    riddorRequired: riddorFromBool(initial.riddorRequired),
    riddorReportedAt: toDateInput(initial.riddorReportedAt),
    closureReason: initial.closureReason ?? "",
    closedAt: toDateTimeLocal(initial.closedAt),
    safeguardingDiscussed: initial.safeguardingDiscussed,
    safeguardingDiscussedAt: toDateTimeLocal(initial.safeguardingDiscussedAt),
    safeguardingNotes: initial.safeguardingNotes ?? "",
  };
}

export type IncidentEditFormAction =
  | { type: "setStatus"; value: IncidentStatus }
  | { type: "setSeverity"; value: IncidentSeverity | "unset" }
  | { type: "setInternalNotes"; value: string }
  | { type: "setActionsTaken"; value: string }
  | { type: "setTargetCompletionDate"; value: string }
  | { type: "setRiddorRequired"; value: IncidentRiddorState }
  | { type: "setRiddorReportedAt"; value: string }
  | { type: "setClosureReason"; value: string }
  | { type: "setClosedAt"; value: string }
  | { type: "setSafeguardingDiscussed"; value: boolean }
  | { type: "setSafeguardingDiscussedAt"; value: string }
  | { type: "setSafeguardingNotes"; value: string };

export function incidentEditReducer(
  state: IncidentEditFormState,
  action: IncidentEditFormAction,
): IncidentEditFormState {
  switch (action.type) {
    case "setStatus":
      return { ...state, status: action.value };
    case "setSeverity":
      return { ...state, severity: action.value };
    case "setInternalNotes":
      return { ...state, internalNotes: action.value };
    case "setActionsTaken":
      return { ...state, actionsTaken: action.value };
    case "setTargetCompletionDate":
      return { ...state, targetCompletionDate: action.value };
    case "setRiddorRequired":
      return { ...state, riddorRequired: action.value };
    case "setRiddorReportedAt":
      return { ...state, riddorReportedAt: action.value };
    case "setClosureReason":
      return { ...state, closureReason: action.value };
    case "setClosedAt":
      return { ...state, closedAt: action.value };
    case "setSafeguardingDiscussed":
      return { ...state, safeguardingDiscussed: action.value };
    case "setSafeguardingDiscussedAt":
      return { ...state, safeguardingDiscussedAt: action.value };
    case "setSafeguardingNotes":
      return { ...state, safeguardingNotes: action.value };
  }
}

export interface IncidentPatchPayload {
  status: IncidentStatus;
  severity: IncidentSeverity | null;
  actionsTaken: string | null;
  targetCompletionDate: string | null;
  riddorRequired: boolean | null;
  riddorReportedAt: string | null;
  internalNotes: string | null;
  closureReason: string | null;
  closedAt: string | null;
  safeguardingDiscussed: boolean;
  safeguardingDiscussedAt: string | null;
  safeguardingNotes: string | null;
}

/**
 * Build the PATCH payload for the incident-report admin endpoint.
 * Whitespace-only text fields collapse to null so they don't overwrite
 * "unset" with empty strings. The tri-state `riddorRequired` collapses
 * to a strict boolean | null.
 */
export function buildIncidentPayload(
  state: IncidentEditFormState,
): IncidentPatchPayload {
  return {
    status: state.status,
    severity: state.severity === "unset" ? null : state.severity,
    actionsTaken: state.actionsTaken.trim() || null,
    targetCompletionDate: fromDateInput(state.targetCompletionDate),
    riddorRequired:
      state.riddorRequired === "unset" ? null : state.riddorRequired === "yes",
    riddorReportedAt: fromDateInput(state.riddorReportedAt),
    internalNotes: state.internalNotes.trim() || null,
    closureReason: state.closureReason.trim() || null,
    closedAt: fromDateTimeLocal(state.closedAt),
    safeguardingDiscussed: state.safeguardingDiscussed,
    safeguardingDiscussedAt: fromDateTimeLocal(state.safeguardingDiscussedAt),
    safeguardingNotes: state.safeguardingNotes.trim() || null,
  };
}
