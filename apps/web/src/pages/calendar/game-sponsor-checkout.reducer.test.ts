import { describe, expect, it } from "vitest";
import {
  buildGameSponsorPayloadOptionals,
  gameSponsorCheckoutFormReducer,
  initialGameSponsorCheckoutFormState,
  isGameSponsorFormValid,
  MAX_MESSAGE_CHARS,
  type GameSponsorCheckoutFormState,
} from "./game-sponsor-checkout.reducer";

const validBase: GameSponsorCheckoutFormState = {
  ...initialGameSponsorCheckoutFormState,
  sponsorName: "Acme",
  sponsorEmail: "a@b.com",
};

describe("gameSponsorCheckoutFormReducer", () => {
  it("starts at the details step with empty fields", () => {
    expect(initialGameSponsorCheckoutFormState).toEqual({
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

  it("setSponsorName updates only sponsorName", () => {
    const next = gameSponsorCheckoutFormReducer(
      initialGameSponsorCheckoutFormState,
      { type: "setSponsorName", value: "Acme" },
    );
    expect(next.sponsorName).toBe("Acme");
    expect(next.sponsorEmail).toBe("");
  });

  it("setSponsorEmail updates only sponsorEmail", () => {
    const next = gameSponsorCheckoutFormReducer(
      initialGameSponsorCheckoutFormState,
      { type: "setSponsorEmail", value: "a@b.com" },
    );
    expect(next.sponsorEmail).toBe("a@b.com");
  });

  it("setLogo stores the data URL and clears any previous error", () => {
    const withError = {
      ...initialGameSponsorCheckoutFormState,
      logoError: "boom",
    };
    const next = gameSponsorCheckoutFormReducer(withError, {
      type: "setLogo",
      dataUrl: "data:foo",
    });
    expect(next.logoDataUrl).toBe("data:foo");
    expect(next.logoError).toBeNull();
  });

  it("setLogoError surfaces the error and drops any stale data URL", () => {
    const withLogo = {
      ...initialGameSponsorCheckoutFormState,
      logoDataUrl: "data:old",
    };
    const next = gameSponsorCheckoutFormReducer(withLogo, {
      type: "setLogoError",
      error: "Failed",
    });
    expect(next.logoError).toBe("Failed");
    expect(next.logoDataUrl).toBeNull();
  });

  it("clearLogo wipes both logo fields", () => {
    const dirty = {
      ...initialGameSponsorCheckoutFormState,
      logoDataUrl: "data:foo",
      logoError: "err",
    };
    const next = gameSponsorCheckoutFormReducer(dirty, { type: "clearLogo" });
    expect(next.logoDataUrl).toBeNull();
    expect(next.logoError).toBeNull();
  });

  it("setStep transitions through details → paying → success", () => {
    let s = gameSponsorCheckoutFormReducer(
      initialGameSponsorCheckoutFormState,
      { type: "setStep", step: "paying" },
    );
    expect(s.step).toBe("paying");
    s = gameSponsorCheckoutFormReducer(s, {
      type: "setStep",
      step: "success",
    });
    expect(s.step).toBe("success");
  });
});

describe("isGameSponsorFormValid", () => {
  it("requires name, email with @, and no logo error", () => {
    expect(isGameSponsorFormValid(initialGameSponsorCheckoutFormState)).toBe(
      false,
    );
    expect(
      isGameSponsorFormValid({ ...validBase, sponsorEmail: "no-at" }),
    ).toBe(false);
    expect(isGameSponsorFormValid(validBase)).toBe(true);
  });

  it("rejects when message exceeds the cap", () => {
    expect(
      isGameSponsorFormValid({
        ...validBase,
        sponsorMessage: "x".repeat(MAX_MESSAGE_CHARS + 1),
      }),
    ).toBe(false);
  });

  it("rejects when there's a logo error", () => {
    expect(isGameSponsorFormValid({ ...validBase, logoError: "Bad" })).toBe(
      false,
    );
  });
});

describe("buildGameSponsorPayloadOptionals", () => {
  it("collapses empty optional fields to undefined", () => {
    expect(buildGameSponsorPayloadOptionals(validBase)).toEqual({
      sponsorName: "Acme",
      sponsorEmail: "a@b.com",
      sponsorWebsite: undefined,
      sponsorPhone: undefined,
      sponsorLogoDataUrl: undefined,
      sponsorMessage: undefined,
    });
  });

  it("forwards filled optional fields", () => {
    expect(
      buildGameSponsorPayloadOptionals({
        ...validBase,
        sponsorWebsite: "https://acme.com",
        sponsorPhone: "0123",
        sponsorMessage: "good luck",
        logoDataUrl: "data:image/png;base64,xxx",
      }),
    ).toEqual({
      sponsorName: "Acme",
      sponsorEmail: "a@b.com",
      sponsorWebsite: "https://acme.com",
      sponsorPhone: "0123",
      sponsorLogoDataUrl: "data:image/png;base64,xxx",
      sponsorMessage: "good luck",
    });
  });
});
