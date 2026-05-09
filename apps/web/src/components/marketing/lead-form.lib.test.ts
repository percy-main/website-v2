import { describe, expect, it } from "vitest";
import {
  buildLeadPayload,
  emptyToUndefined,
  isLeadFormReady,
  normalisePhone,
  safeEmail,
  safeTrim,
  type AdultFormData,
  type JuniorFormData,
} from "./lead-form.lib";

interface FakeConsent {
  ad_user_data: "denied";
  ad_storage: "denied";
  version: string;
  recordedAt: string;
}

const consent: FakeConsent = {
  ad_user_data: "denied",
  ad_storage: "denied",
  version: "v1",
  recordedAt: "2026-05-09T00:00:00.000Z",
};

const adultEmpty: AdultFormData = {
  name: "",
  email: "",
  phone: "",
  notes: "",
  honeypot: "",
};

const juniorEmpty: JuniorFormData = {
  childName: "",
  parentName: "",
  parentEmail: "",
  parentPhone: "",
  notes: "",
  honeypot: "",
};

describe("safeTrim", () => {
  it("trims leading/trailing whitespace", () => {
    expect(safeTrim("  hi  ")).toBe("hi");
  });
});

describe("emptyToUndefined", () => {
  it("returns undefined for blank/whitespace input", () => {
    expect(emptyToUndefined("")).toBeUndefined();
    expect(emptyToUndefined("   ")).toBeUndefined();
  });

  it("returns trimmed value for non-empty input", () => {
    expect(emptyToUndefined("  hello  ")).toBe("hello");
  });
});

describe("safeEmail", () => {
  it("accepts a normal email", () => {
    expect(safeEmail("a@b.co")).toBe("a@b.co");
  });

  it("trims and accepts an email with whitespace", () => {
    expect(safeEmail("  a@b.co  ")).toBe("a@b.co");
  });

  it("rejects emails with no '@'", () => {
    expect(safeEmail("ab.co")).toBeUndefined();
  });

  it("rejects emails with no '.'", () => {
    expect(safeEmail("a@bco")).toBeUndefined();
  });

  it("rejects empty input", () => {
    expect(safeEmail("")).toBeUndefined();
    expect(safeEmail("   ")).toBeUndefined();
  });

  it("rejects emails with multiple @", () => {
    expect(safeEmail("a@b@c.co")).toBeUndefined();
  });
});

describe("normalisePhone", () => {
  it("returns undefined for empty/whitespace input", () => {
    expect(normalisePhone("")).toBeUndefined();
    expect(normalisePhone("  ")).toBeUndefined();
  });

  it("strips formatting from a UK-style number", () => {
    expect(normalisePhone("0191 555 1234")).toBe("01915551234");
  });

  it("preserves a leading + for E.164", () => {
    expect(normalisePhone("+44 191 555 1234")).toBe("+441915551234");
  });

  it("returns undefined when there are no digits", () => {
    expect(normalisePhone("(--)")).toBeUndefined();
  });
});

describe("isLeadFormReady", () => {
  it("rejects empty adult form", () => {
    expect(
      isLeadFormReady({
        variant: "adult",
        adult: adultEmpty,
        junior: juniorEmpty,
      }),
    ).toBe(false);
  });

  it("accepts adult form with name + valid email", () => {
    expect(
      isLeadFormReady({
        variant: "adult",
        adult: { ...adultEmpty, name: "Sam", email: "sam@example.com" },
        junior: juniorEmpty,
      }),
    ).toBe(true);
  });

  it("rejects adult form with invalid email", () => {
    expect(
      isLeadFormReady({
        variant: "adult",
        adult: { ...adultEmpty, name: "Sam", email: "not-an-email" },
        junior: juniorEmpty,
      }),
    ).toBe(false);
  });

  it("requires childName, parentName, valid parentEmail for junior", () => {
    const base = {
      ...juniorEmpty,
      childName: "Kid",
      parentName: "Adult",
      parentEmail: "p@x.com",
    };
    expect(
      isLeadFormReady({
        variant: "junior",
        adult: adultEmpty,
        junior: base,
      }),
    ).toBe(true);

    expect(
      isLeadFormReady({
        variant: "junior",
        adult: adultEmpty,
        junior: { ...base, childName: "" },
      }),
    ).toBe(false);
    expect(
      isLeadFormReady({
        variant: "junior",
        adult: adultEmpty,
        junior: { ...base, parentName: "" },
      }),
    ).toBe(false);
    expect(
      isLeadFormReady({
        variant: "junior",
        adult: adultEmpty,
        junior: { ...base, parentEmail: "bad" },
      }),
    ).toBe(false);
  });
});

describe("buildLeadPayload", () => {
  it("builds adult payload with required fields only", () => {
    const out = buildLeadPayload({
      campaignId: "camp",
      segment: "adult",
      variant: "adult",
      adult: { ...adultEmpty, name: " Sam ", email: " sam@example.com " },
      junior: juniorEmpty,
      consent,
    });

    expect(out).toEqual({
      campaignId: "camp",
      segment: "adult",
      name: "Sam",
      email: "sam@example.com",
      source: "landing-adult",
      consent,
    });
  });

  it("includes phone when provided (normalised)", () => {
    const out = buildLeadPayload({
      campaignId: "camp",
      segment: "adult",
      variant: "adult",
      adult: {
        ...adultEmpty,
        name: "Sam",
        email: "sam@example.com",
        phone: "0191 555 1234",
      },
      junior: juniorEmpty,
      consent,
    });

    expect(out.phone).toBe("01915551234");
  });

  it("includes notes in fields when provided", () => {
    const out = buildLeadPayload({
      campaignId: "camp",
      segment: "adult",
      variant: "adult",
      adult: {
        ...adultEmpty,
        name: "Sam",
        email: "sam@example.com",
        notes: "  hi there  ",
      },
      junior: juniorEmpty,
      consent,
    });
    expect(out.fields).toEqual({ notes: "hi there" });
  });

  it("does not include fields when empty", () => {
    const out = buildLeadPayload({
      campaignId: "camp",
      segment: "adult",
      variant: "adult",
      adult: { ...adultEmpty, name: "Sam", email: "sam@example.com" },
      junior: juniorEmpty,
      consent,
    });
    expect(out.fields).toBeUndefined();
  });

  it("includes attribution when provided", () => {
    const attribution = { source: "google" };
    const out = buildLeadPayload({
      campaignId: "camp",
      segment: "adult",
      variant: "adult",
      adult: { ...adultEmpty, name: "Sam", email: "sam@example.com" },
      junior: juniorEmpty,
      attribution,
      consent,
    });
    expect(out.attribution).toEqual(attribution);
  });

  it("includes honeypot when non-empty", () => {
    const out = buildLeadPayload({
      campaignId: "camp",
      segment: "adult",
      variant: "adult",
      adult: {
        ...adultEmpty,
        name: "Sam",
        email: "sam@example.com",
        honeypot: "bot-value",
      },
      junior: juniorEmpty,
      consent,
    });
    expect(out.honeypot).toBe("bot-value");
  });

  it("builds junior payload with child_name in fields", () => {
    const out = buildLeadPayload({
      campaignId: "camp",
      segment: "junior",
      variant: "junior",
      adult: adultEmpty,
      junior: {
        ...juniorEmpty,
        childName: " Kid ",
        parentName: " Adult ",
        parentEmail: "p@x.com",
        parentPhone: "01915551234",
        notes: "loves cricket",
      },
      consent,
    });

    expect(out).toEqual({
      campaignId: "camp",
      segment: "junior",
      name: "Adult",
      email: "p@x.com",
      phone: "01915551234",
      source: "landing-junior",
      fields: { notes: "loves cricket", child_name: "Kid" },
      consent,
    });
  });

  it("junior payload omits child_name when empty", () => {
    const out = buildLeadPayload({
      campaignId: "camp",
      segment: "junior",
      variant: "junior",
      adult: adultEmpty,
      junior: {
        ...juniorEmpty,
        childName: "   ",
        parentName: "Adult",
        parentEmail: "p@x.com",
      },
      consent,
    });
    expect(out.fields).toBeUndefined();
  });
});
