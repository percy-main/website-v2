import { describe, expect, it } from "vitest";
import {
  buildDependentFields,
  buildMemberDetailFields,
  canDeleteCharge,
  formatConsent,
  formatSex,
  getChargeStatus,
  getRoleLabel,
  isMemberArchived,
  joinPair,
  parseNewChargeForm,
  summariseCharges,
  type Charge,
  type Dependent,
  type Member,
} from "./member-detail-modal.lib";

function makeCharge(overrides: Partial<Charge> = {}): Charge {
  return {
    id: "c1",
    member_id: "m1",
    description: "Match fee",
    amount_pence: 500,
    charge_date: "2025-04-01",
    created_at: "2025-04-01T10:00:00Z",
    created_by: "u1",
    paid_at: null,
    payment_confirmed_at: null,
    payment_method: null,
    stripe_payment_intent_id: null,
    type: "match_fee",
    source: "system",
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
    ...overrides,
  };
}

function makeMember(overrides: Partial<NonNullable<Member>> = {}): NonNullable<
  Member
> {
  return {
    id: "m1",
    email: "alex@example.com",
    name: "Alex Young",
    title: null,
    address: null,
    postcode: null,
    dob: null,
    telephone: null,
    member_category: null,
    play_cricket_id: null,
    slug: null,
    stripe_customer_id: null,
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
    emergency_contact_name: null,
    emergency_contact_telephone: null,
    ...overrides,
  };
}

function makeDependent(overrides: Partial<Dependent> = {}): Dependent {
  return {
    id: "d1",
    name: "Junior Doe",
    dob: null,
    sex: null,
    school_year: null,
    photo_consent: null,
    gp_surgery: null,
    gp_phone: null,
    alt_contact_name: null,
    alt_contact_phone: null,
    emergency_medical_consent: null,
    has_disability: null,
    disability_type: null,
    medical_info: null,
    membershipPaidUntil: null,
    ...overrides,
  } as Dependent;
}

describe("formatSex", () => {
  it("returns null for null/empty input", () => {
    expect(formatSex(null)).toBeNull();
    expect(formatSex("")).toBeNull();
  });

  it("humanises prefer_not_to_say", () => {
    expect(formatSex("prefer_not_to_say")).toBe("Prefer not to say");
  });

  it("title-cases the first letter of any other value", () => {
    expect(formatSex("male")).toBe("Male");
    expect(formatSex("female")).toBe("Female");
    expect(formatSex("nonbinary")).toBe("Nonbinary");
  });
});

describe("formatConsent", () => {
  it("returns null when value is null (unset)", () => {
    expect(formatConsent(null)).toBeNull();
  });

  it("returns Yes/No for boolean values", () => {
    expect(formatConsent(true)).toBe("Yes");
    expect(formatConsent(false)).toBe("No");
  });
});

describe("joinPair", () => {
  it("joins two non-empty strings with ' / '", () => {
    expect(joinPair("Surgery A", "0123")).toBe("Surgery A / 0123");
  });

  it("returns the single non-empty value when one side is missing", () => {
    expect(joinPair("Surgery A", null)).toBe("Surgery A");
    expect(joinPair(undefined, "0123")).toBe("0123");
  });

  it("returns null when both values are empty/null", () => {
    expect(joinPair(null, null)).toBeNull();
    expect(joinPair("", "")).toBeNull();
  });
});

describe("buildMemberDetailFields", () => {
  it("includes all eight static rows in stable order", () => {
    const member = makeMember({
      title: "Mr",
      address: "1 Cricket Lane",
      postcode: "NE1 1AA",
      telephone: "0123",
    });
    const fields = buildMemberDetailFields(member);
    expect(fields.map((f) => f.label)).toEqual([
      "Title",
      "Name",
      "Address",
      "Postcode",
      "Date of Birth",
      "Telephone",
      "Emergency Contact",
      "Emergency Telephone",
    ]);
    expect(fields[0]?.value).toBe("Mr");
    expect(fields[2]?.value).toBe("1 Cricket Lane");
  });

  it("formats DOB when present, otherwise leaves null", () => {
    const dob = "1990-01-15T00:00:00Z";
    const fields = buildMemberDetailFields(makeMember({ dob }));
    const dobField = fields.find((f) => f.label === "Date of Birth");
    expect(dobField?.value).toMatch(/\d{2}\/\d{2}\/\d{4}/);

    const fields2 = buildMemberDetailFields(makeMember({ dob: null }));
    expect(fields2.find((f) => f.label === "Date of Birth")?.value).toBeNull();
  });
});

describe("buildDependentFields", () => {
  it("returns all eight rows with nulls for unset values", () => {
    const fields = buildDependentFields(makeDependent());
    expect(fields).toHaveLength(8);
    for (const f of fields) {
      expect(f.value).toBeNull();
    }
  });

  it("formats sex, consent, and joins gp/alt-contact pairs", () => {
    const fields = buildDependentFields(
      makeDependent({
        sex: "female",
        photo_consent: true,
        gp_surgery: "Surgery A",
        gp_phone: "0123",
        alt_contact_name: "Auntie",
        alt_contact_phone: "0456",
        emergency_medical_consent: false,
      }),
    );
    const byLabel = Object.fromEntries(fields.map((f) => [f.label, f.value]));
    expect(byLabel.Sex).toBe("Female");
    expect(byLabel["Photo Consent"]).toBe("Yes");
    expect(byLabel["GP Surgery / Phone"]).toBe("Surgery A / 0123");
    expect(byLabel["Alt Contact"]).toBe("Auntie / 0456");
    expect(byLabel["Emergency Medical Consent"]).toBe("No");
  });

  it("renders disability type when has_disability is set", () => {
    const f1 = buildDependentFields(
      makeDependent({ has_disability: true, disability_type: "Asthma" }),
    );
    expect(f1.find((f) => f.label === "Disability")?.value).toBe("Asthma");

    const f2 = buildDependentFields(
      makeDependent({ has_disability: true, disability_type: null }),
    );
    expect(f2.find((f) => f.label === "Disability")?.value).toBe("Yes");

    const f3 = buildDependentFields(makeDependent({ has_disability: false }));
    expect(f3.find((f) => f.label === "Disability")?.value).toBeNull();
  });
});

describe("getChargeStatus", () => {
  it("returns Paid (green) when paid_at is set", () => {
    const result = getChargeStatus(
      makeCharge({ paid_at: "2025-04-02T10:00:00Z" }),
    );
    expect(result).toEqual({
      label: "Paid",
      variant: "green",
      status: "paid",
    });
  });

  it("returns Pending (blue) when only payment_confirmed_at is set", () => {
    const result = getChargeStatus(
      makeCharge({ payment_confirmed_at: "2025-04-02T10:00:00Z" }),
    );
    expect(result).toEqual({
      label: "Pending",
      variant: "blue",
      status: "pending",
    });
  });

  it("returns Unpaid (yellow) when neither timestamp is set", () => {
    expect(getChargeStatus(makeCharge())).toEqual({
      label: "Unpaid",
      variant: "yellow",
      status: "unpaid",
    });
  });

  it("prefers paid_at over payment_confirmed_at", () => {
    const result = getChargeStatus(
      makeCharge({
        paid_at: "2025-04-02T10:00:00Z",
        payment_confirmed_at: "2025-04-01T10:00:00Z",
      }),
    );
    expect(result.status).toBe("paid");
  });
});

describe("canDeleteCharge", () => {
  it("allows deleting unpaid charges", () => {
    expect(canDeleteCharge(makeCharge())).toBe(true);
  });

  it("disallows deleting paid charges", () => {
    expect(canDeleteCharge(makeCharge({ paid_at: "2025-04-02" }))).toBe(false);
  });

  it("disallows deleting pending (confirmed) charges", () => {
    expect(
      canDeleteCharge(makeCharge({ payment_confirmed_at: "2025-04-02" })),
    ).toBe(false);
  });
});

describe("summariseCharges", () => {
  it("returns zero counts for an empty list", () => {
    expect(summariseCharges([])).toEqual({
      total: 0,
      paid: 0,
      pending: 0,
      unpaid: 0,
      totalPence: 0,
      unpaidPence: 0,
    });
  });

  it("aggregates counts and pence totals across statuses", () => {
    const charges: Charge[] = [
      makeCharge({ amount_pence: 500, paid_at: "2025-04-02" }),
      makeCharge({ amount_pence: 300, payment_confirmed_at: "2025-04-02" }),
      makeCharge({ amount_pence: 200 }),
      makeCharge({ amount_pence: 100 }),
    ];
    expect(summariseCharges(charges)).toEqual({
      total: 4,
      paid: 1,
      pending: 1,
      unpaid: 2,
      totalPence: 1100,
      unpaidPence: 300,
    });
  });
});

describe("isMemberArchived", () => {
  it("returns false for null member", () => {
    expect(isMemberArchived(null)).toBe(false);
  });

  it("returns false when deleted_at is null", () => {
    expect(isMemberArchived(makeMember({ deleted_at: null }))).toBe(false);
  });

  it("returns true when deleted_at is set", () => {
    expect(
      isMemberArchived(makeMember({ deleted_at: "2025-04-01T00:00:00Z" })),
    ).toBe(true);
  });
});

describe("parseNewChargeForm", () => {
  it("rejects an empty description", () => {
    expect(
      parseNewChargeForm({
        description: "",
        amount: "5",
        chargeDate: "2025-04-01",
      }).ok,
    ).toBe(false);
    expect(
      parseNewChargeForm({
        description: "   ",
        amount: "5",
        chargeDate: "2025-04-01",
      }).ok,
    ).toBe(false);
  });

  it("rejects amounts below 1p", () => {
    expect(
      parseNewChargeForm({
        description: "Match fee",
        amount: "0",
        chargeDate: "2025-04-01",
      }).ok,
    ).toBe(false);
    expect(
      parseNewChargeForm({
        description: "Match fee",
        amount: "abc",
        chargeDate: "2025-04-01",
      }).ok,
    ).toBe(false);
  });

  it("converts pounds to pence and trims the description", () => {
    expect(
      parseNewChargeForm({
        description: "  Tea fund  ",
        amount: "12.50",
        chargeDate: "2025-04-01",
      }),
    ).toEqual({
      ok: true,
      description: "Tea fund",
      amountPence: 1250,
      chargeDate: "2025-04-01",
    });
  });
});

describe("getRoleLabel", () => {
  it("returns the human label for known roles", () => {
    expect(getRoleLabel("admin")).toBe("Admin");
    expect(getRoleLabel("junior_manager")).toBe("Junior Manager");
    expect(getRoleLabel("official")).toBe("Official");
  });

  it("falls back to 'User' for unknown / null roles", () => {
    expect(getRoleLabel(null)).toBe("User");
    expect(getRoleLabel(undefined)).toBe("User");
    expect(getRoleLabel("user")).toBe("User");
    expect(getRoleLabel("strange")).toBe("User");
  });
});
