/**
 * State + reducer for the player sponsor-checkout details form.
 *
 * Pure (no React, no Stripe) so it can be unit-tested without a renderer.
 * Stripe state (clientSecret, payment status) is intentionally NOT in this
 * reducer — Stripe SDK ownership boundaries matter, so the component keeps
 * those as separate state.
 *
 * `step` (details/paying/success) is also kept here because it's plain
 * UI flow, not Stripe-owned.
 */

export const MAX_MESSAGE_CHARS = 100;

export type SponsorCheckoutStep = "details" | "paying" | "success";

export interface SponsorCheckoutFormState {
  step: SponsorCheckoutStep;
  sponsorName: string;
  sponsorEmail: string;
  sponsorWebsite: string;
  sponsorPhone: string;
  sponsorMessage: string;
  logoDataUrl: string | null;
  logoError: string | null;
}

export const initialSponsorCheckoutFormState: SponsorCheckoutFormState = {
  step: "details",
  sponsorName: "",
  sponsorEmail: "",
  sponsorWebsite: "",
  sponsorPhone: "",
  sponsorMessage: "",
  logoDataUrl: null,
  logoError: null,
};

export type SponsorCheckoutFormAction =
  | { type: "setSponsorName"; value: string }
  | { type: "setSponsorEmail"; value: string }
  | { type: "setSponsorWebsite"; value: string }
  | { type: "setSponsorPhone"; value: string }
  | { type: "setSponsorMessage"; value: string }
  | { type: "setLogo"; dataUrl: string | null }
  | { type: "setLogoError"; error: string | null }
  | { type: "clearLogo" }
  | { type: "setStep"; step: SponsorCheckoutStep };

export function sponsorCheckoutFormReducer(
  state: SponsorCheckoutFormState,
  action: SponsorCheckoutFormAction,
): SponsorCheckoutFormState {
  switch (action.type) {
    case "setSponsorName":
      return { ...state, sponsorName: action.value };
    case "setSponsorEmail":
      return { ...state, sponsorEmail: action.value };
    case "setSponsorWebsite":
      return { ...state, sponsorWebsite: action.value };
    case "setSponsorPhone":
      return { ...state, sponsorPhone: action.value };
    case "setSponsorMessage":
      return { ...state, sponsorMessage: action.value };
    case "setLogo":
      // Successful resize: clear any previous error too.
      return { ...state, logoDataUrl: action.dataUrl, logoError: null };
    case "setLogoError":
      // Resize failure: drop any stale data URL and surface the error.
      return { ...state, logoError: action.error, logoDataUrl: null };
    case "clearLogo":
      return { ...state, logoDataUrl: null, logoError: null };
    case "setStep":
      return { ...state, step: action.step };
  }
}

/**
 * Whether the form is ready to submit. Mirrors the original component
 * predicate so test coverage protects the gating rule.
 */
export function isSponsorFormValid(state: SponsorCheckoutFormState): boolean {
  return (
    state.sponsorName.trim().length > 0 &&
    state.sponsorEmail.trim().length > 0 &&
    state.sponsorEmail.includes("@") &&
    state.sponsorMessage.length <= MAX_MESSAGE_CHARS &&
    !state.logoError
  );
}

/**
 * Build the optional fields portion of the create-payment payload.
 * Empty strings collapse to undefined; null logo to undefined. The
 * caller adds the route-specific fields (slug, playerName, gameId).
 */
export function buildSponsorPayloadOptionals(state: SponsorCheckoutFormState): {
  sponsorName: string;
  sponsorEmail: string;
  sponsorWebsite: string | undefined;
  sponsorPhone: string | undefined;
  sponsorLogoDataUrl: string | undefined;
  sponsorMessage: string | undefined;
} {
  return {
    sponsorName: state.sponsorName,
    sponsorEmail: state.sponsorEmail,
    sponsorWebsite: state.sponsorWebsite || undefined,
    sponsorPhone: state.sponsorPhone || undefined,
    sponsorLogoDataUrl: state.logoDataUrl ?? undefined,
    sponsorMessage: state.sponsorMessage || undefined,
  };
}
