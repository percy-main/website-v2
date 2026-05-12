/**
 * State + reducer + helpers for the "Notify Members" dialog on the
 * availability request detail page.
 *
 * The dialog used to manage seven independent useState calls that
 * had to mutate together (preview round-trip, recipient list,
 * checkboxes, dialog reset). Folding them into one reducer keeps
 * the related transitions co-located and lets us unit-test the
 * tricky bits — additional-email parsing and "send" payload
 * building — without booting React.
 *
 * The player-availability cluster on the same page is a separate
 * concern and stays where it is.
 */

export interface NotifyRecipient {
  email: string;
  name: string | null;
  source: "filter" | "manual";
}

export interface NotifyFormState {
  /** Member category filter, or "" for all categories. */
  memberCategory: string;
  /** Membership status filter, or "" for any status. */
  membershipStatus: string;
  /** User group filter, or "" for no group filter. */
  userGroupId: string;
  /** Comma-separated additional email addresses to add to the list. */
  manualEmails: string;
  /**
   * Recipients returned by the preview endpoint. Empty until the
   * admin presses "Preview Recipients".
   */
  recipients: NotifyRecipient[];
  /** Email addresses currently checked for sending. */
  checked: Set<string>;
  /** Whether the preview has run successfully (drives the two-step UI). */
  previewed: boolean;
}

export const initialNotifyFormState: NotifyFormState = {
  memberCategory: "",
  membershipStatus: "",
  userGroupId: "",
  manualEmails: "",
  recipients: [],
  checked: new Set(),
  previewed: false,
};

export type NotifyFormAction =
  | { type: "setMemberCategory"; value: string }
  | { type: "setMembershipStatus"; value: string }
  | { type: "setUserGroupId"; value: string }
  | { type: "setManualEmails"; value: string }
  | { type: "previewSucceeded"; recipients: NotifyRecipient[] }
  | { type: "toggleRecipient"; email: string }
  | { type: "toggleAll" }
  | { type: "reset" };

export function notifyFormReducer(
  state: NotifyFormState,
  action: NotifyFormAction,
): NotifyFormState {
  switch (action.type) {
    case "setMemberCategory":
      return { ...state, memberCategory: action.value };
    case "setMembershipStatus":
      return { ...state, membershipStatus: action.value };
    case "setUserGroupId":
      return { ...state, userGroupId: action.value };
    case "setManualEmails":
      return { ...state, manualEmails: action.value };
    case "previewSucceeded":
      return {
        ...state,
        recipients: action.recipients,
        // Default every previewed recipient to checked — admin opts
        // people *out* rather than in.
        checked: new Set(action.recipients.map((r) => r.email)),
        previewed: true,
      };
    case "toggleRecipient": {
      const next = new Set(state.checked);
      if (next.has(action.email)) {
        next.delete(action.email);
      } else {
        next.add(action.email);
      }
      return { ...state, checked: next };
    }
    case "toggleAll": {
      // If everyone is checked, deselect all; otherwise select all.
      if (state.checked.size === state.recipients.length) {
        return { ...state, checked: new Set() };
      }
      return {
        ...state,
        checked: new Set(state.recipients.map((r) => r.email)),
      };
    }
    case "reset":
      return initialNotifyFormState;
  }
}

/**
 * Split the free-text "Additional Emails" field on commas and trim
 * each entry. Returns `undefined` when there's nothing useful so the
 * API call can omit the field entirely (matching the previous
 * inline behaviour).
 */
export function parseAdditionalEmails(raw: string): string[] | undefined {
  if (!raw) return undefined;
  const parts: string[] = [];
  for (const piece of raw.split(",")) {
    const trimmed = piece.trim();
    if (trimmed.length > 0) parts.push(trimmed);
  }
  return parts.length > 0 ? parts : undefined;
}

/** Body payload for the preview endpoint, derived from filter state. */
export interface PreviewPayload {
  memberCategory?: string;
  membershipStatus?: "active" | "lapsed";
  userGroupId?: string;
  additionalEmails?: string[];
}

export function buildPreviewPayload(state: NotifyFormState): PreviewPayload {
  return {
    memberCategory: state.memberCategory || undefined,
    membershipStatus:
      (state.membershipStatus as "active" | "lapsed") || undefined,
    userGroupId: state.userGroupId || undefined,
    additionalEmails: parseAdditionalEmails(state.manualEmails),
  };
}

/** Recipients to actually send to — the checked subset of the preview. */
export function buildSendRecipients(
  state: NotifyFormState,
): Array<{ email: string; name: string | null }> {
  return state.recipients.flatMap((r) =>
    state.checked.has(r.email) ? [{ email: r.email, name: r.name }] : [],
  );
}
