/**
 * State + reducer for the "Add Fee Rate" form on the Match Fees admin tab.
 *
 * Kept as pure functions (no React imports) so it can be unit-tested
 * without a renderer. The component owns React-side concerns (focus,
 * mutations, layout); this file owns "given input X, what is the new
 * draft state?" and "is this form ready to submit?".
 */

export interface NewRateFormState {
  category: string;
  amount: string;
  teamId: string; // "all" means no team scope
  competitionType: string; // "" means no competition scope
}

export const initialNewRateFormState: NewRateFormState = {
  category: "",
  amount: "",
  teamId: "all",
  competitionType: "",
};

export type NewRateFormAction =
  | { type: "setCategory"; value: string }
  | { type: "setAmount"; value: string }
  | { type: "setTeamId"; value: string }
  | { type: "setCompetitionType"; value: string }
  | { type: "reset" };

export function newRateFormReducer(
  state: NewRateFormState,
  action: NewRateFormAction,
): NewRateFormState {
  switch (action.type) {
    case "setCategory":
      return { ...state, category: action.value };
    case "setAmount":
      return { ...state, amount: action.value };
    case "setTeamId":
      return { ...state, teamId: action.value };
    case "setCompetitionType":
      return { ...state, competitionType: action.value };
    case "reset":
      return initialNewRateFormState;
  }
}

/**
 * Parse a free-text pounds string into integer pence.
 * Returns null if the input is empty, not a number, or negative.
 */
export function parseAmountPence(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const pounds = parseFloat(trimmed);
  if (Number.isNaN(pounds) || pounds < 0) return null;
  return Math.round(pounds * 100);
}

/**
 * The form can submit only when category + amount are present and the
 * amount parses to a non-negative integer.
 */
export function isFormReady(state: NewRateFormState): boolean {
  if (!state.category) return false;
  return parseAmountPence(state.amount) !== null;
}

/**
 * Build the API payload from the current form state.
 * Returns null if the form is not ready (caller should disable submit).
 */
export function buildAddRatePayload(state: NewRateFormState): {
  memberCategory: string;
  amountPence: number;
  playCricketTeamId?: string;
  competitionType?: string;
} | null {
  const amountPence = parseAmountPence(state.amount);
  if (!state.category || amountPence === null) return null;
  return {
    memberCategory: state.category,
    amountPence,
    playCricketTeamId: state.teamId === "all" ? undefined : state.teamId,
    competitionType: state.competitionType || undefined,
  };
}
