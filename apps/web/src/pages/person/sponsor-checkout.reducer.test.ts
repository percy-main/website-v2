import { describe, expect, it } from "vitest";
import {
  buildSponsorPayloadOptionals,
  initialSponsorCheckoutFormState,
  isSponsorFormValid,
  MAX_MESSAGE_CHARS,
  sponsorCheckoutFormReducer,
  type SponsorCheckoutFormState,
} from "./sponsor-checkout.reducer";

const validBase: SponsorCheckoutFormState = {
  ...initialSponsorCheckoutFormState,
  sponsorName: "Acme Co",
  sponsorEmail: "a@b.com",
};

describe("sponsorCheckoutFormReducer", () => {
  it("starts at the details step with empty fields", () => {
    expect(initialSponsorCheckoutFormState).toEqual({
      step: "details",
      sponsorName: "",
      sponsorEmail: "",
      sponsorWebsite: "",
      sponsorPhone: "",
      sponsorMessage: "",
      logoDataUrl: null,
      logoError: null,
    });
  });

  it("setSponsorName/Email/Website/Phone/Message update only that field", () => {
    let s = sponsorCheckoutFormReducer(initialSponsorCheckoutFormState, {
      type: "setSponsorName",
      value: "Acme",
    });
    s = sponsorCheckoutFormReducer(s, {
      type: "setSponsorEmail",
      value: "a@b.com",
    });
    s = sponsorCheckoutFormReducer(s, {
      type: "setSponsorWebsite",
      value: "https://acme.com",
    });
    s = sponsorCheckoutFormReducer(s, {
      type: "setSponsorPhone",
      value: "0123",
    });
    s = sponsorCheckoutFormReducer(s, {
      type: "setSponsorMessage",
      value: "hi",
    });
    expect(s).toMatchObject({
      sponsorName: "Acme",
      sponsorEmail: "a@b.com",
      sponsorWebsite: "https://acme.com",
      sponsorPhone: "0123",
      sponsorMessage: "hi",
    });
  });

  it("setLogo stores the data URL and clears any previous error", () => {
    const withError = {
      ...initialSponsorCheckoutFormState,
      logoError: "boom",
    };
    const next = sponsorCheckoutFormReducer(withError, {
      type: "setLogo",
      dataUrl: "data:image/png;base64,xxx",
    });
    expect(next.logoDataUrl).toBe("data:image/png;base64,xxx");
    expect(next.logoError).toBeNull();
  });

  it("setLogoError surfaces the error and drops any stale data URL", () => {
    const withLogo = {
      ...initialSponsorCheckoutFormState,
      logoDataUrl: "data:image/png;base64,old",
    };
    const next = sponsorCheckoutFormReducer(withLogo, {
      type: "setLogoError",
      error: "Failed",
    });
    expect(next.logoError).toBe("Failed");
    expect(next.logoDataUrl).toBeNull();
  });

  it("clearLogo wipes both logo fields", () => {
    const filled = {
      ...initialSponsorCheckoutFormState,
      logoDataUrl: "data:foo",
      logoError: "err",
    };
    const next = sponsorCheckoutFormReducer(filled, { type: "clearLogo" });
    expect(next.logoDataUrl).toBeNull();
    expect(next.logoError).toBeNull();
  });

  it("setStep transitions through details → paying → success", () => {
    let s = sponsorCheckoutFormReducer(initialSponsorCheckoutFormState, {
      type: "setStep",
      step: "paying",
    });
    expect(s.step).toBe("paying");
    s = sponsorCheckoutFormReducer(s, { type: "setStep", step: "success" });
    expect(s.step).toBe("success");
  });
});

describe("isSponsorFormValid", () => {
  it("is false when name is blank", () => {
    expect(isSponsorFormValid(initialSponsorCheckoutFormState)).toBe(false);
  });

  it("is false when email is missing or has no @", () => {
    expect(
      isSponsorFormValid({ ...validBase, sponsorEmail: "no-at-sign" }),
    ).toBe(false);
    expect(isSponsorFormValid({ ...validBase, sponsorEmail: "" })).toBe(false);
  });

  it("is true with name + email containing @", () => {
    expect(isSponsorFormValid(validBase)).toBe(true);
  });

  it("is false when message exceeds the cap", () => {
    expect(
      isSponsorFormValid({
        ...validBase,
        sponsorMessage: "x".repeat(MAX_MESSAGE_CHARS + 1),
      }),
    ).toBe(false);
  });

  it("is false when there's a logo error", () => {
    expect(
      isSponsorFormValid({ ...validBase, logoError: "Bad image" }),
    ).toBe(false);
  });
});

describe("buildSponsorPayloadOptionals", () => {
  it("collapses empty optional fields to undefined", () => {
    expect(buildSponsorPayloadOptionals(validBase)).toEqual({
      sponsorName: "Acme Co",
      sponsorEmail: "a@b.com",
      sponsorWebsite: undefined,
      sponsorPhone: undefined,
      sponsorLogoDataUrl: undefined,
      sponsorMessage: undefined,
    });
  });

  it("forwards filled optional fields", () => {
    expect(
      buildSponsorPayloadOptionals({
        ...validBase,
        sponsorWebsite: "https://acme.com",
        sponsorPhone: "0123",
        sponsorMessage: "good luck",
        logoDataUrl: "data:image/png;base64,xxx",
      }),
    ).toEqual({
      sponsorName: "Acme Co",
      sponsorEmail: "a@b.com",
      sponsorWebsite: "https://acme.com",
      sponsorPhone: "0123",
      sponsorLogoDataUrl: "data:image/png;base64,xxx",
      sponsorMessage: "good luck",
    });
  });
});
