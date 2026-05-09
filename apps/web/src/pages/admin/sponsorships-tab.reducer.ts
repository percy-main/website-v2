/**
 * State + reducers for the two "Create Sponsorship" dialogs in the
 * Sponsorships admin tab.
 *
 * Both dialogs (game + player) collect the same broad shape of sponsor
 * data (name, email, optional website/phone/message, amount, optional
 * display name + notes). The player variant additionally tracks a
 * player slug + denormalised playerName picked from the PlayerSelect.
 *
 * Each form state is collapsed into a single useReducer so the
 * `onSuccess` reset is a single dispatch, and so unit tests can
 * exercise transitions without mounting React.
 *
 * Helpers (`parseSponsorshipAmountPence`, `is*Ready`, `build*Payload`)
 * encode the input -> wire-format mapping that previously lived inline
 * in `handleSubmit`. Keeping them here lets us cover edge cases
 * (empty/negative/decimal amounts) without rendering the dialog.
 */

// ---- Shared field type ----

type SponsorshipFormField =
  | "sponsorName"
  | "sponsorEmail"
  | "website"
  | "phone"
  | "message"
  | "amount"
  | "displayName"
  | "notes";

// Message is capped at 100 chars to match the input's maxLength.
const MESSAGE_MAX_LENGTH = 100;

// ---- Game sponsorship form ----

export interface GameSponsorshipFormState {
  gameId: string;
  sponsorName: string;
  sponsorEmail: string;
  website: string;
  phone: string;
  message: string;
  amount: string;
  displayName: string;
  notes: string;
}

export const initialGameSponsorshipFormState: GameSponsorshipFormState = {
  gameId: "",
  sponsorName: "",
  sponsorEmail: "",
  website: "",
  phone: "",
  message: "",
  amount: "",
  displayName: "",
  notes: "",
};

export type GameSponsorshipFormAction =
  | { type: "setGameId"; value: string }
  | { type: "setField"; field: SponsorshipFormField; value: string }
  | { type: "reset" };

export function gameSponsorshipFormReducer(
  state: GameSponsorshipFormState,
  action: GameSponsorshipFormAction,
): GameSponsorshipFormState {
  switch (action.type) {
    case "setGameId":
      return { ...state, gameId: action.value };
    case "setField":
      if (action.field === "message") {
        return {
          ...state,
          message: action.value.slice(0, MESSAGE_MAX_LENGTH),
        };
      }
      return { ...state, [action.field]: action.value };
    case "reset":
      return initialGameSponsorshipFormState;
  }
}

// ---- Player sponsorship form ----

export interface PlayerSponsorshipFormState {
  slug: string;
  playerName: string;
  sponsorName: string;
  sponsorEmail: string;
  website: string;
  phone: string;
  message: string;
  amount: string;
  displayName: string;
  notes: string;
}

export const initialPlayerSponsorshipFormState: PlayerSponsorshipFormState = {
  slug: "",
  playerName: "",
  sponsorName: "",
  sponsorEmail: "",
  website: "",
  phone: "",
  message: "",
  amount: "",
  displayName: "",
  notes: "",
};

export type PlayerSponsorshipFormAction =
  | { type: "setPlayer"; slug: string; playerName: string }
  | { type: "setField"; field: SponsorshipFormField; value: string }
  | { type: "reset" };

export function playerSponsorshipFormReducer(
  state: PlayerSponsorshipFormState,
  action: PlayerSponsorshipFormAction,
): PlayerSponsorshipFormState {
  switch (action.type) {
    case "setPlayer":
      return { ...state, slug: action.slug, playerName: action.playerName };
    case "setField":
      if (action.field === "message") {
        return {
          ...state,
          message: action.value.slice(0, MESSAGE_MAX_LENGTH),
        };
      }
      return { ...state, [action.field]: action.value };
    case "reset":
      return initialPlayerSponsorshipFormState;
  }
}

// ---- Helpers ----

/**
 * Parses the raw amount input (in GBP) into pence. Returns null if the
 * input does not represent a positive finite number; the form is not
 * "ready" in that case so the mutation is never dispatched.
 *
 * Rounds to the nearest pence to mirror the wire format expected by
 * the API.
 */
export function parseSponsorshipAmountPence(input: string): number | null {
  if (input.trim() === "") return null;
  const parsed = parseFloat(input);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0) return null;
  return Math.round(parsed * 100);
}

export function isGameSponsorshipReady(state: GameSponsorshipFormState): boolean {
  if (!state.gameId.trim()) return false;
  if (!state.sponsorName.trim()) return false;
  if (!state.sponsorEmail.trim()) return false;
  return parseSponsorshipAmountPence(state.amount) !== null;
}

export function isPlayerSponsorshipReady(
  state: PlayerSponsorshipFormState,
): boolean {
  if (!state.slug || !state.playerName) return false;
  if (!state.sponsorName.trim()) return false;
  if (!state.sponsorEmail.trim()) return false;
  return parseSponsorshipAmountPence(state.amount) !== null;
}

export interface GameSponsorshipPayload {
  gameId: string;
  sponsorName: string;
  sponsorEmail: string;
  amountPence: number;
  sponsorWebsite?: string;
  sponsorPhone?: string;
  sponsorMessage?: string;
  displayName?: string;
  notes?: string;
}

export function buildGameSponsorshipPayload(
  state: GameSponsorshipFormState,
): GameSponsorshipPayload | null {
  const amountPence = parseSponsorshipAmountPence(state.amount);
  if (amountPence === null) return null;
  return {
    gameId: state.gameId,
    sponsorName: state.sponsorName,
    sponsorEmail: state.sponsorEmail,
    amountPence,
    ...(state.website ? { sponsorWebsite: state.website } : {}),
    ...(state.phone ? { sponsorPhone: state.phone } : {}),
    ...(state.message ? { sponsorMessage: state.message } : {}),
    ...(state.displayName ? { displayName: state.displayName } : {}),
    ...(state.notes ? { notes: state.notes } : {}),
  };
}

export interface PlayerSponsorshipPayload {
  slug: string;
  playerName: string;
  sponsorName: string;
  sponsorEmail: string;
  amountPence: number;
  sponsorWebsite?: string;
  sponsorPhone?: string;
  sponsorMessage?: string;
  displayName?: string;
  notes?: string;
}

export function buildPlayerSponsorshipPayload(
  state: PlayerSponsorshipFormState,
): PlayerSponsorshipPayload | null {
  const amountPence = parseSponsorshipAmountPence(state.amount);
  if (amountPence === null) return null;
  return {
    slug: state.slug,
    playerName: state.playerName,
    sponsorName: state.sponsorName,
    sponsorEmail: state.sponsorEmail,
    amountPence,
    ...(state.website ? { sponsorWebsite: state.website } : {}),
    ...(state.phone ? { sponsorPhone: state.phone } : {}),
    ...(state.message ? { sponsorMessage: state.message } : {}),
    ...(state.displayName ? { displayName: state.displayName } : {}),
    ...(state.notes ? { notes: state.notes } : {}),
  };
}
