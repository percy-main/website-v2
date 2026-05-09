/**
 * Wizard state, reducer, and validation helpers for the
 * junior-membership registration page.
 *
 * The page used to manage step + dependents array + per-dependent
 * validation errors + payment intent state via several useState
 * calls scattered through one ~1.2k-line component. Consolidating
 * the wizard state here lets us:
 *
 *  - Unit-test the safeguarding / H&S validators (children, contact,
 *    medical, consents) without booting React.
 *  - Keep transitions like "advance only if validation is clean"
 *    explicit instead of buried in event handlers.
 *
 * Pure functions only; no React or fetch imports.
 */

import { differenceInYears } from "date-fns";

// ──────────────────────────────────────────────────────────────────
// Domain types
// ──────────────────────────────────────────────────────────────────

export interface Dependent {
  /** Stable client-side id for React keys; not sent to the API. */
  clientId: string;
  name: string;
  sex: string;
  dob: string;
  school_year: string;
  played_before: boolean | null;
  previous_cricket: string;
  whatsapp_consent: boolean | null;
  alt_contact_name: string;
  alt_contact_phone: string;
  alt_contact_whatsapp_consent: boolean | null;
  gp_surgery: string;
  gp_phone: string;
  has_disability: boolean | null;
  disability_type: string;
  medical_info: string;
  emergency_medical_consent: boolean | null;
  medical_fitness_declaration: boolean | null;
  data_protection_consent: boolean | null;
  photo_consent: boolean | null;
}

export type Step =
  | "children"
  | "cricket"
  | "contact"
  | "medical"
  | "consents"
  | "review"
  | "payment"
  | "done";

export const STEPS: Step[] = [
  "children",
  "cricket",
  "contact",
  "medical",
  "consents",
  "review",
  "payment",
];

export const STEP_LABELS: Record<Step, string> = {
  children: "Children",
  cricket: "Cricket",
  contact: "Contact",
  medical: "Medical",
  consents: "Consents",
  review: "Review",
  payment: "Payment",
  done: "Done",
};

export interface PaymentData {
  clientSecret: string;
  totalAmountPence: number;
  paymentIntentId: string;
}

// ──────────────────────────────────────────────────────────────────
// Pricing helpers (unchanged behaviour, made pure & testable)
// ──────────────────────────────────────────────────────────────────

export const FIRST_CHILD_PRICE = 50;
export const ADDITIONAL_CHILD_PRICE = 40;

export const priceForChild = (existingCount: number, newIndex: number) =>
  existingCount + newIndex === 0 ? FIRST_CHILD_PRICE : ADDITIONAL_CHILD_PRICE;

export const calculateTotal = (existingCount: number, newCount: number) => {
  let total = 0;
  for (let i = 0; i < newCount; i++) {
    total += priceForChild(existingCount, i);
  }
  return total;
};

// ──────────────────────────────────────────────────────────────────
// Empty dependent factory
// ──────────────────────────────────────────────────────────────────

/**
 * Build a fresh, blank dependent. The default `clientId` factory uses
 * `crypto.randomUUID`; tests can pass an explicit id to keep snapshots
 * deterministic.
 */
export const emptyDependent = (clientId?: string): Dependent => ({
  clientId: clientId ?? crypto.randomUUID(),
  name: "",
  sex: "",
  dob: "",
  school_year: "",
  played_before: null,
  previous_cricket: "",
  whatsapp_consent: null,
  alt_contact_name: "",
  alt_contact_phone: "",
  alt_contact_whatsapp_consent: null,
  gp_surgery: "",
  gp_phone: "",
  has_disability: null,
  disability_type: "",
  medical_info: "",
  emergency_medical_consent: null,
  medical_fitness_declaration: null,
  data_protection_consent: null,
  photo_consent: null,
});

// ──────────────────────────────────────────────────────────────────
// Validators — one per wizard step
//
// Each returns `string[]` aligned with the `dependents` array so the
// form can render error text under each child. Empty string == clean.
//
// These encode safeguarding / H&S logic (under-18, emergency medical
// consent, medical fitness declaration, data-protection, photo
// consent), so they're the primary test target — mistakes here are
// safety-critical, not just UX.
// ──────────────────────────────────────────────────────────────────

export const validateChildrenStep = (
  deps: Dependent[],
  now: Date = new Date(),
): string[] =>
  deps.map((dep) => {
    if (!dep.name.trim()) return "Name is required.";
    if (!dep.sex) return "Gender is required.";
    if (!dep.dob) return "Date of birth is required.";
    if (!dep.school_year) return "School year is required.";
    const age = differenceInYears(now, new Date(dep.dob));
    if (age >= 18) return `${dep.name} must be under 18.`;
    if (age < 0) return `Invalid date of birth for ${dep.name}.`;
    return "";
  });

export const validateCricketStep = (deps: Dependent[]): string[] =>
  deps.map((dep) => {
    if (dep.played_before === null)
      return "Please indicate if your child has played cricket before.";
    return "";
  });

export const validateContactStep = (deps: Dependent[]): string[] =>
  deps.map((dep) => {
    if (dep.whatsapp_consent === null) return "WhatsApp consent is required.";
    if (!dep.alt_contact_name.trim())
      return "Alternative contact name is required.";
    if (!dep.alt_contact_phone.trim())
      return "Alternative contact phone number is required.";
    if (dep.alt_contact_whatsapp_consent === null)
      return "Alternative contact WhatsApp consent is required.";
    return "";
  });

export const validateMedicalStep = (deps: Dependent[]): string[] =>
  deps.map((dep) => {
    if (!dep.gp_surgery.trim()) return "GP surgery name is required.";
    if (!dep.gp_phone.trim()) return "GP phone number is required.";
    if (dep.has_disability === null)
      return "Please indicate whether your child has a disability.";
    if (dep.emergency_medical_consent === null)
      return "Emergency medical consent is required.";
    if (!dep.emergency_medical_consent)
      return "You must consent to emergency medical treatment to register.";
    if (dep.medical_fitness_declaration === null)
      return "Medical fitness declaration is required.";
    if (!dep.medical_fitness_declaration)
      return "You must confirm the medical fitness declaration to register.";
    return "";
  });

export const validateConsentsStep = (deps: Dependent[]): string[] =>
  deps.map((dep) => {
    if (dep.data_protection_consent === null)
      return "Data protection consent is required.";
    if (!dep.data_protection_consent)
      return "You must consent to data processing to register.";
    if (dep.photo_consent === null) return "Photo consent is required.";
    return "";
  });

/**
 * Run the validator that corresponds to the given step. Steps that
 * don't have a validator (review/payment/done) return all-clean.
 * `now` is threaded through so children-step age math stays
 * deterministic in tests.
 */
export function validateStep(
  step: Step,
  deps: Dependent[],
  now: Date = new Date(),
): string[] {
  switch (step) {
    case "children":
      return validateChildrenStep(deps, now);
    case "cricket":
      return validateCricketStep(deps);
    case "contact":
      return validateContactStep(deps);
    case "medical":
      return validateMedicalStep(deps);
    case "consents":
      return validateConsentsStep(deps);
    default:
      return deps.map(() => "");
  }
}

// ──────────────────────────────────────────────────────────────────
// Wizard reducer
// ──────────────────────────────────────────────────────────────────

export interface JuniorWizardState {
  step: Step;
  dependents: Dependent[];
  /** Per-dependent error message; "" means clean. */
  errors: string[];
  paymentData: PaymentData | null;
  paymentError: string | null;
}

/**
 * Initial wizard state. Takes a single blank dependent so the first
 * "Child 1" card is always visible. Tests can pass a deterministic
 * `clientId` to keep snapshots stable.
 */
export function initialJuniorWizardState(
  firstChildClientId?: string,
): JuniorWizardState {
  return {
    step: "children",
    dependents: [emptyDependent(firstChildClientId)],
    errors: [],
    paymentData: null,
    paymentError: null,
  };
}

export type JuniorWizardAction =
  | { type: "addChild"; child?: Dependent }
  | { type: "removeChild"; index: number }
  | {
      type: "updateDependent";
      index: number;
      updates: Partial<Dependent>;
    }
  | {
      type: "advanceIfValid";
      next: Step;
      now?: Date;
    }
  | { type: "goToStep"; step: Step }
  | { type: "setPaymentData"; data: PaymentData | null }
  | { type: "setPaymentError"; message: string | null };

export function juniorWizardReducer(
  state: JuniorWizardState,
  action: JuniorWizardAction,
): JuniorWizardState {
  switch (action.type) {
    case "addChild":
      return {
        ...state,
        dependents: [...state.dependents, action.child ?? emptyDependent()],
        errors: [...state.errors, ""],
      };
    case "removeChild": {
      // Always keep at least one child card visible.
      if (state.dependents.length <= 1) return state;
      return {
        ...state,
        dependents: state.dependents.filter((_, i) => i !== action.index),
        errors: state.errors.filter((_, i) => i !== action.index),
      };
    }
    case "updateDependent": {
      const dependents = state.dependents.map((d, i) =>
        i === action.index ? { ...d, ...action.updates } : d,
      );
      // Clear *this* child's error so the user isn't held back by
      // stale text once they've started fixing the field. Other
      // children's errors stay until their next validation pass.
      const errors = state.errors.map((e, i) => (i === action.index ? "" : e));
      return { ...state, dependents, errors };
    }
    case "advanceIfValid": {
      const errors = validateStep(
        state.step,
        state.dependents,
        action.now ?? new Date(),
      );
      if (errors.some((e) => e !== "")) {
        return { ...state, errors };
      }
      return { ...state, errors, step: action.next };
    }
    case "goToStep":
      return { ...state, step: action.step };
    case "setPaymentData":
      return { ...state, paymentData: action.data };
    case "setPaymentError":
      return { ...state, paymentError: action.message };
  }
}
