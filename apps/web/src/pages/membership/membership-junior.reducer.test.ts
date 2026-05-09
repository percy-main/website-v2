import { describe, expect, it } from "vitest";
import {
  ADDITIONAL_CHILD_PRICE,
  FIRST_CHILD_PRICE,
  calculateTotal,
  emptyDependent,
  initialJuniorWizardState,
  juniorWizardReducer,
  priceForChild,
  validateChildrenStep,
  validateConsentsStep,
  validateContactStep,
  validateCricketStep,
  validateMedicalStep,
  validateStep,
  type Dependent,
} from "./membership-junior.reducer";

// Stable now reference for age math.
const NOW = new Date("2026-05-09T00:00:00Z");

/**
 * Build a fully-valid Dependent so each test can mutate just the
 * field under test. Defaults are tuned so all five validators
 * return "" — failing tests therefore *only* fail on the field
 * being asserted.
 */
function valid(overrides: Partial<Dependent> = {}): Dependent {
  return {
    ...emptyDependent("test-id"),
    name: "Alex Junior",
    sex: "male",
    dob: "2014-01-01",
    school_year: "Year 7",
    played_before: false,
    previous_cricket: "",
    whatsapp_consent: true,
    alt_contact_name: "Sam Parent",
    alt_contact_phone: "07000000000",
    alt_contact_whatsapp_consent: true,
    gp_surgery: "Wallsend Health Centre",
    gp_phone: "01911234567",
    has_disability: false,
    disability_type: "",
    medical_info: "",
    emergency_medical_consent: true,
    medical_fitness_declaration: true,
    data_protection_consent: true,
    photo_consent: true,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────
// Pricing helpers
// ──────────────────────────────────────────────────────────────────

describe("priceForChild / calculateTotal", () => {
  it("first child of the household pays the first-child price", () => {
    expect(priceForChild(0, 0)).toBe(FIRST_CHILD_PRICE);
  });

  it("subsequent children pay the additional-child price", () => {
    expect(priceForChild(0, 1)).toBe(ADDITIONAL_CHILD_PRICE);
    expect(priceForChild(0, 2)).toBe(ADDITIONAL_CHILD_PRICE);
  });

  it("when household already has a paid child, all new ones are additional-priced", () => {
    expect(priceForChild(1, 0)).toBe(ADDITIONAL_CHILD_PRICE);
    expect(priceForChild(2, 0)).toBe(ADDITIONAL_CHILD_PRICE);
  });

  it("calculateTotal sums up first + additional", () => {
    expect(calculateTotal(0, 1)).toBe(FIRST_CHILD_PRICE);
    expect(calculateTotal(0, 2)).toBe(FIRST_CHILD_PRICE + ADDITIONAL_CHILD_PRICE);
    expect(calculateTotal(0, 3)).toBe(
      FIRST_CHILD_PRICE + ADDITIONAL_CHILD_PRICE * 2,
    );
  });

  it("calculateTotal treats the existing-child case as all additional", () => {
    expect(calculateTotal(1, 2)).toBe(ADDITIONAL_CHILD_PRICE * 2);
  });
});

// ──────────────────────────────────────────────────────────────────
// validateChildrenStep — safeguarding: under-18 + required fields
// ──────────────────────────────────────────────────────────────────

describe("validateChildrenStep", () => {
  it("returns clean for a fully-populated under-18", () => {
    expect(validateChildrenStep([valid()], NOW)).toEqual([""]);
  });

  it("flags missing name", () => {
    expect(validateChildrenStep([valid({ name: "  " })], NOW)).toEqual([
      "Name is required.",
    ]);
  });

  it("flags missing gender", () => {
    expect(validateChildrenStep([valid({ sex: "" })], NOW)).toEqual([
      "Gender is required.",
    ]);
  });

  it("flags missing date of birth", () => {
    expect(validateChildrenStep([valid({ dob: "" })], NOW)).toEqual([
      "Date of birth is required.",
    ]);
  });

  it("flags missing school year", () => {
    expect(validateChildrenStep([valid({ school_year: "" })], NOW)).toEqual([
      "School year is required.",
    ]);
  });

  it("rejects a child who is 18 or older", () => {
    // 18th birthday already passed — must be under 18 to register.
    const dep = valid({ name: "Adult Sam", dob: "2007-01-01" });
    expect(validateChildrenStep([dep], NOW)).toEqual([
      "Adult Sam must be under 18.",
    ]);
  });

  it("accepts a child who is exactly 17 (under 18)", () => {
    const dep = valid({ dob: "2008-06-01" });
    expect(validateChildrenStep([dep], NOW)).toEqual([""]);
  });

  it("rejects a date of birth in the future as invalid", () => {
    const dep = valid({ name: "Future Kid", dob: "2030-01-01" });
    expect(validateChildrenStep([dep], NOW)).toEqual([
      "Invalid date of birth for Future Kid.",
    ]);
  });

  it("validates each child independently", () => {
    const a = valid({ name: "A" });
    const b = valid({ name: "B", dob: "" });
    expect(validateChildrenStep([a, b], NOW)).toEqual([
      "",
      "Date of birth is required.",
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────
// validateCricketStep — single yes/no
// ──────────────────────────────────────────────────────────────────

describe("validateCricketStep", () => {
  it("flags an unanswered played_before", () => {
    expect(validateCricketStep([valid({ played_before: null })])).toEqual([
      "Please indicate if your child has played cricket before.",
    ]);
  });

  it("accepts both yes and no answers", () => {
    expect(validateCricketStep([valid({ played_before: true })])).toEqual([""]);
    expect(validateCricketStep([valid({ played_before: false })])).toEqual([""]);
  });
});

// ──────────────────────────────────────────────────────────────────
// validateContactStep — alt-contact required for safeguarding
// ──────────────────────────────────────────────────────────────────

describe("validateContactStep", () => {
  it("returns clean when all contact fields are populated", () => {
    expect(validateContactStep([valid()])).toEqual([""]);
  });

  it("flags missing whatsapp_consent decision", () => {
    expect(
      validateContactStep([valid({ whatsapp_consent: null })]),
    ).toEqual(["WhatsApp consent is required."]);
  });

  it("flags blank alternative-contact name", () => {
    expect(
      validateContactStep([valid({ alt_contact_name: "  " })]),
    ).toEqual(["Alternative contact name is required."]);
  });

  it("flags blank alternative-contact phone", () => {
    expect(
      validateContactStep([valid({ alt_contact_phone: "" })]),
    ).toEqual(["Alternative contact phone number is required."]);
  });

  it("flags missing alt-contact whatsapp consent", () => {
    expect(
      validateContactStep([valid({ alt_contact_whatsapp_consent: null })]),
    ).toEqual(["Alternative contact WhatsApp consent is required."]);
  });
});

// ──────────────────────────────────────────────────────────────────
// validateMedicalStep — H&S: emergency consent + fitness declaration
// ──────────────────────────────────────────────────────────────────

describe("validateMedicalStep", () => {
  it("returns clean when GP, disability, and both H&S consents are set", () => {
    expect(validateMedicalStep([valid()])).toEqual([""]);
  });

  it("flags blank GP surgery", () => {
    expect(validateMedicalStep([valid({ gp_surgery: "" })])).toEqual([
      "GP surgery name is required.",
    ]);
  });

  it("flags blank GP phone", () => {
    expect(validateMedicalStep([valid({ gp_phone: "" })])).toEqual([
      "GP phone number is required.",
    ]);
  });

  it("flags missing disability decision", () => {
    expect(validateMedicalStep([valid({ has_disability: null })])).toEqual([
      "Please indicate whether your child has a disability.",
    ]);
  });

  it("requires explicit emergency medical consent decision", () => {
    expect(
      validateMedicalStep([valid({ emergency_medical_consent: null })]),
    ).toEqual(["Emergency medical consent is required."]);
  });

  it("blocks registration when emergency medical consent is denied", () => {
    expect(
      validateMedicalStep([valid({ emergency_medical_consent: false })]),
    ).toEqual([
      "You must consent to emergency medical treatment to register.",
    ]);
  });

  it("requires explicit medical fitness declaration", () => {
    expect(
      validateMedicalStep([valid({ medical_fitness_declaration: null })]),
    ).toEqual(["Medical fitness declaration is required."]);
  });

  it("blocks registration when medical fitness declaration is denied", () => {
    expect(
      validateMedicalStep([valid({ medical_fitness_declaration: false })]),
    ).toEqual([
      "You must confirm the medical fitness declaration to register.",
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────
// validateConsentsStep — GDPR + photo
// ──────────────────────────────────────────────────────────────────

describe("validateConsentsStep", () => {
  it("returns clean when both consents are set", () => {
    expect(validateConsentsStep([valid()])).toEqual([""]);
  });

  it("flags missing data-protection decision", () => {
    expect(
      validateConsentsStep([valid({ data_protection_consent: null })]),
    ).toEqual(["Data protection consent is required."]);
  });

  it("blocks registration when data-protection consent is denied", () => {
    expect(
      validateConsentsStep([valid({ data_protection_consent: false })]),
    ).toEqual(["You must consent to data processing to register."]);
  });

  it("requires explicit photo consent decision", () => {
    expect(
      validateConsentsStep([valid({ photo_consent: null })]),
    ).toEqual(["Photo consent is required."]);
  });

  it("photo consent of false is a valid decision (parent can opt out)", () => {
    expect(
      validateConsentsStep([valid({ photo_consent: false })]),
    ).toEqual([""]);
  });
});

// ──────────────────────────────────────────────────────────────────
// validateStep dispatcher
// ──────────────────────────────────────────────────────────────────

describe("validateStep", () => {
  it("dispatches to validateChildrenStep for the children step", () => {
    expect(validateStep("children", [valid({ name: "" })], NOW)).toEqual([
      "Name is required.",
    ]);
  });

  it("returns all-clean for non-validating steps", () => {
    expect(validateStep("review", [valid(), valid()], NOW)).toEqual(["", ""]);
    expect(validateStep("payment", [valid()], NOW)).toEqual([""]);
    expect(validateStep("done", [valid()], NOW)).toEqual([""]);
  });
});

// ──────────────────────────────────────────────────────────────────
// juniorWizardReducer
// ──────────────────────────────────────────────────────────────────

describe("juniorWizardReducer", () => {
  it("starts with one blank dependent on the children step", () => {
    const state = initialJuniorWizardState("first");
    expect(state.step).toBe("children");
    expect(state.dependents).toHaveLength(1);
    expect(state.dependents[0].clientId).toBe("first");
    expect(state.errors).toEqual([]);
  });

  it("addChild appends a blank dependent and an empty error slot", () => {
    const start = initialJuniorWizardState("first");
    const next = juniorWizardReducer(start, {
      type: "addChild",
      child: emptyDependent("second"),
    });
    expect(next.dependents.map((d) => d.clientId)).toEqual([
      "first",
      "second",
    ]);
    expect(next.errors).toEqual([""]);
  });

  it("removeChild deletes the dependent at the given index", () => {
    let state = initialJuniorWizardState("a");
    state = juniorWizardReducer(state, {
      type: "addChild",
      child: emptyDependent("b"),
    });
    state = juniorWizardReducer(state, { type: "removeChild", index: 0 });
    expect(state.dependents.map((d) => d.clientId)).toEqual(["b"]);
  });

  it("removeChild refuses to delete the last remaining dependent", () => {
    const state = initialJuniorWizardState("only");
    const next = juniorWizardReducer(state, {
      type: "removeChild",
      index: 0,
    });
    expect(next.dependents).toHaveLength(1);
    expect(next).toBe(state);
  });

  it("updateDependent merges fields for the right index and clears that error", () => {
    let state = initialJuniorWizardState("a");
    state = juniorWizardReducer(state, {
      type: "addChild",
      child: emptyDependent("b"),
    });
    // Seed errors for both children.
    state = { ...state, errors: ["A error", "B error"] };
    const next = juniorWizardReducer(state, {
      type: "updateDependent",
      index: 0,
      updates: { name: "Alex" },
    });
    expect(next.dependents[0].name).toBe("Alex");
    expect(next.dependents[1].name).toBe("");
    // Only this child's error was cleared.
    expect(next.errors).toEqual(["", "B error"]);
  });

  it("advanceIfValid blocks navigation and stores errors when validation fails", () => {
    const state = initialJuniorWizardState("a");
    // Default empty dependent will fail children-step validation.
    const next = juniorWizardReducer(state, {
      type: "advanceIfValid",
      next: "cricket",
      now: NOW,
    });
    expect(next.step).toBe("children");
    expect(next.errors[0]).not.toBe("");
  });

  it("advanceIfValid moves to the next step when validation is clean", () => {
    let state = initialJuniorWizardState("a");
    state = juniorWizardReducer(state, {
      type: "updateDependent",
      index: 0,
      updates: valid(),
    });
    const next = juniorWizardReducer(state, {
      type: "advanceIfValid",
      next: "cricket",
      now: NOW,
    });
    expect(next.step).toBe("cricket");
    expect(next.errors).toEqual([""]);
  });

  it("goToStep is unconditional (used for back buttons)", () => {
    const state = initialJuniorWizardState("a");
    const next = juniorWizardReducer(state, {
      type: "goToStep",
      step: "review",
    });
    expect(next.step).toBe("review");
  });

  it("setPaymentData and setPaymentError manage the payment slot", () => {
    let state = initialJuniorWizardState("a");
    state = juniorWizardReducer(state, {
      type: "setPaymentData",
      data: {
        clientSecret: "pi_123_secret_abc",
        totalAmountPence: 5000,
        paymentIntentId: "pi_123",
      },
    });
    expect(state.paymentData?.paymentIntentId).toBe("pi_123");
    state = juniorWizardReducer(state, {
      type: "setPaymentError",
      message: "Stripe blew up",
    });
    expect(state.paymentError).toBe("Stripe blew up");
  });
});
