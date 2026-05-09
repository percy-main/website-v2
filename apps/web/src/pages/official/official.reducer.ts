/**
 * State + reducers + helpers for the official's matchday page.
 *
 * Two related but independent clusters live here so they can be
 * tested without React:
 *
 *   1. `confirmationFormReducer` — the per-player status map used
 *      while the official is confirming the match-day team.
 *   2. `expenseFormReducer` — the "Add Expense" dialog inside the
 *      ExpensesSection (umpire/scorer/teas/match-ball etc).
 *
 * Both belong to the same matchday confirmation flow, so they share
 * a file. Pure helpers (`parsePencePounds`, payload builders) cover
 * the awkward "free-text pounds → integer pence" step that's easy
 * to get wrong.
 */

// ──────────────────────────────────────────────────────────────────
// confirmationFormReducer
// ──────────────────────────────────────────────────────────────────

export type PlayerStatus = "playing" | "dropped_out" | "no_show";

export interface ConfirmationFormState {
  /** Whether the confirmation UI is currently visible. */
  confirming: boolean;
  /** Per-player status keyed by matchday-player id. */
  playerStatuses: Record<string, PlayerStatus>;
}

export const initialConfirmationFormState: ConfirmationFormState = {
  confirming: false,
  playerStatuses: {},
};

export type ConfirmationFormAction =
  | { type: "start"; playerIds: string[] }
  | { type: "setStatus"; playerId: string; status: PlayerStatus }
  | { type: "cancel" }
  | { type: "reset" };

export function confirmationFormReducer(
  state: ConfirmationFormState,
  action: ConfirmationFormAction,
): ConfirmationFormState {
  switch (action.type) {
    case "start": {
      // Default everyone to "playing"; the official then drops out
      // or marks no-shows from there.
      const playerStatuses: Record<string, PlayerStatus> = {};
      for (const id of action.playerIds) {
        playerStatuses[id] = "playing";
      }
      return { confirming: true, playerStatuses };
    }
    case "setStatus":
      return {
        ...state,
        playerStatuses: {
          ...state.playerStatuses,
          [action.playerId]: action.status,
        },
      };
    case "cancel":
      return { ...state, confirming: false };
    case "reset":
      return initialConfirmationFormState;
  }
}

/** Build the `/confirm` body from confirmation state. */
export function buildConfirmPayload(state: ConfirmationFormState): {
  playerStatuses: Array<{ matchdayPlayerId: string; status: PlayerStatus }>;
} {
  return {
    playerStatuses: Object.entries(state.playerStatuses).map(
      ([matchdayPlayerId, status]) => ({ matchdayPlayerId, status }),
    ),
  };
}

// ──────────────────────────────────────────────────────────────────
// expenseFormReducer
// ──────────────────────────────────────────────────────────────────

export type ExpenseType =
  | "umpire_fee"
  | "scorer_fee"
  | "match_ball"
  | "teas"
  | "miscellaneous";

export interface ExpenseFormState {
  expenseType: ExpenseType;
  description: string;
  /** Free-text pounds, e.g. "5.50". Parsed via `parsePencePounds`. */
  amount: string;
  /** Match-ball-specific: was a new ball used? */
  matchBallUsed: boolean;
  /** Match-ball-specific: free-text pounds for the new ball. */
  matchBallCost: string;
  /** Data URL of the compressed receipt preview, or null. */
  receiptPreview: string | null;
  /** Data URL actually sent to the API. */
  receiptDataUrl: string | null;
  /** Receipt image is being downsized in the worker. */
  compressing: boolean;
}

export const initialExpenseFormState: ExpenseFormState = {
  expenseType: "umpire_fee",
  description: "",
  amount: "",
  matchBallUsed: true,
  matchBallCost: "",
  receiptPreview: null,
  receiptDataUrl: null,
  compressing: false,
};

export type ExpenseFormAction =
  | { type: "setExpenseType"; value: ExpenseType }
  | { type: "setDescription"; value: string }
  | { type: "setAmount"; value: string }
  | { type: "setMatchBallUsed"; value: boolean }
  | { type: "setMatchBallCost"; value: string }
  | {
      type: "setReceipt";
      preview: string | null;
      dataUrl: string | null;
    }
  | { type: "setCompressing"; value: boolean }
  | { type: "resetFields" }
  | { type: "reset" };

export function expenseFormReducer(
  state: ExpenseFormState,
  action: ExpenseFormAction,
): ExpenseFormState {
  switch (action.type) {
    case "setExpenseType":
      // Switching expense types wipes per-type fields so an old
      // umpire-fee description doesn't leak into the match-ball form.
      return {
        ...initialExpenseFormState,
        expenseType: action.value,
      };
    case "setDescription":
      return { ...state, description: action.value };
    case "setAmount":
      return { ...state, amount: action.value };
    case "setMatchBallUsed":
      return { ...state, matchBallUsed: action.value };
    case "setMatchBallCost":
      return { ...state, matchBallCost: action.value };
    case "setReceipt":
      return {
        ...state,
        receiptPreview: action.preview,
        receiptDataUrl: action.dataUrl,
      };
    case "setCompressing":
      return { ...state, compressing: action.value };
    case "resetFields":
      // Clear inputs but keep the currently-selected expense type so
      // the admin can add another of the same type quickly.
      return {
        ...initialExpenseFormState,
        expenseType: state.expenseType,
      };
    case "reset":
      return initialExpenseFormState;
  }
}

/**
 * Parse a free-text pounds string ("5", "5.50", " 0.99 ") into an
 * integer number of pence. Returns null if the input is empty, not
 * a number, or negative — the caller should disable submit in those
 * cases. Rounds half-pence up (consistent with `parseAmountPence` on
 * the match-fees admin page).
 */
export function parsePencePounds(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const pounds = parseFloat(trimmed);
  if (Number.isNaN(pounds) || pounds < 0) return null;
  return Math.round(pounds * 100);
}

/** Body for `/api/matchday/{matchId}/expenses`. */
export interface AddExpensePayload {
  type: ExpenseType;
  description?: string;
  amountPence: number;
  receiptImage?: string;
}

/**
 * Build the add-expense payload from the form. Returns null when the
 * form isn't ready: match-ball requires `matchBallUsed` + a positive
 * cost; everything else requires a positive amount.
 */
export function buildAddExpensePayload(
  state: ExpenseFormState,
): AddExpensePayload | null {
  if (state.expenseType === "match_ball") {
    if (!state.matchBallUsed) return null;
    const amountPence = parsePencePounds(state.matchBallCost);
    if (amountPence === null || amountPence <= 0) return null;
    return {
      type: "match_ball",
      description: "New match ball",
      amountPence,
      receiptImage: state.receiptDataUrl ?? undefined,
    };
  }

  const amountPence = parsePencePounds(state.amount);
  if (amountPence === null) return null;
  return {
    type: state.expenseType,
    description: state.description.trim() || undefined,
    amountPence,
    receiptImage: state.receiptDataUrl ?? undefined,
  };
}
