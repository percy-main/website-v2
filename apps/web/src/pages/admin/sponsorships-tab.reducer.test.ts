import { describe, expect, it } from "vitest";
import {
  buildGameSponsorshipPayload,
  buildPlayerSponsorshipPayload,
  gameSponsorshipFormReducer,
  initialGameSponsorshipFormState,
  initialPlayerSponsorshipFormState,
  isGameSponsorshipReady,
  isPlayerSponsorshipReady,
  parseSponsorshipAmountPence,
  playerSponsorshipFormReducer,
} from "./sponsorships-tab.reducer";

describe("parseSponsorshipAmountPence", () => {
  it("returns null for empty string", () => {
    expect(parseSponsorshipAmountPence("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseSponsorshipAmountPence("   ")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(parseSponsorshipAmountPence("abc")).toBeNull();
  });

  it("returns null for zero", () => {
    expect(parseSponsorshipAmountPence("0")).toBeNull();
  });

  it("returns null for negative amounts", () => {
    expect(parseSponsorshipAmountPence("-50")).toBeNull();
  });

  it("converts whole pounds to pence", () => {
    expect(parseSponsorshipAmountPence("50")).toBe(5000);
  });

  it("rounds decimals to the nearest pence", () => {
    expect(parseSponsorshipAmountPence("12.345")).toBe(1235);
    expect(parseSponsorshipAmountPence("12.344")).toBe(1234);
  });

  it("handles decimal pence correctly", () => {
    expect(parseSponsorshipAmountPence("0.50")).toBe(50);
    expect(parseSponsorshipAmountPence("0.01")).toBe(1);
  });
});

describe("gameSponsorshipFormReducer", () => {
  it("starts empty", () => {
    expect(initialGameSponsorshipFormState).toEqual({
      gameId: "",
      sponsorName: "",
      sponsorEmail: "",
      website: "",
      phone: "",
      message: "",
      amount: "",
      displayName: "",
      notes: "",
    });
  });

  it("setGameId updates only gameId", () => {
    const next = gameSponsorshipFormReducer(initialGameSponsorshipFormState, {
      type: "setGameId",
      value: "game-123",
    });
    expect(next.gameId).toBe("game-123");
    expect(next.sponsorName).toBe("");
  });

  it("setField updates the named field", () => {
    let s = gameSponsorshipFormReducer(initialGameSponsorshipFormState, {
      type: "setField",
      field: "sponsorName",
      value: "Acme",
    });
    expect(s.sponsorName).toBe("Acme");
    s = gameSponsorshipFormReducer(s, {
      type: "setField",
      field: "sponsorEmail",
      value: "a@b.com",
    });
    expect(s.sponsorEmail).toBe("a@b.com");
    expect(s.sponsorName).toBe("Acme");
  });

  it("setField clamps message to 100 chars", () => {
    const long = "a".repeat(150);
    const next = gameSponsorshipFormReducer(initialGameSponsorshipFormState, {
      type: "setField",
      field: "message",
      value: long,
    });
    expect(next.message).toHaveLength(100);
  });

  it("reset returns to initial state", () => {
    const dirty: typeof initialGameSponsorshipFormState = {
      gameId: "g",
      sponsorName: "n",
      sponsorEmail: "e@e.com",
      website: "https://x",
      phone: "0123",
      message: "msg",
      amount: "10",
      displayName: "dn",
      notes: "nt",
    };
    expect(gameSponsorshipFormReducer(dirty, { type: "reset" })).toEqual(
      initialGameSponsorshipFormState,
    );
  });
});

describe("isGameSponsorshipReady", () => {
  const valid: typeof initialGameSponsorshipFormState = {
    ...initialGameSponsorshipFormState,
    gameId: "g",
    sponsorName: "n",
    sponsorEmail: "e@e.com",
    amount: "25",
  };

  it("is true when required fields are filled and amount is positive", () => {
    expect(isGameSponsorshipReady(valid)).toBe(true);
  });

  it("is false when gameId is missing", () => {
    expect(isGameSponsorshipReady({ ...valid, gameId: "" })).toBe(false);
    expect(isGameSponsorshipReady({ ...valid, gameId: "   " })).toBe(false);
  });

  it("is false when sponsorName or email is missing", () => {
    expect(isGameSponsorshipReady({ ...valid, sponsorName: "" })).toBe(false);
    expect(isGameSponsorshipReady({ ...valid, sponsorEmail: "" })).toBe(false);
  });

  it("is false when amount is empty, zero, or negative", () => {
    expect(isGameSponsorshipReady({ ...valid, amount: "" })).toBe(false);
    expect(isGameSponsorshipReady({ ...valid, amount: "0" })).toBe(false);
    expect(isGameSponsorshipReady({ ...valid, amount: "-1" })).toBe(false);
  });
});

describe("buildGameSponsorshipPayload", () => {
  it("returns null when amount is invalid", () => {
    const state = {
      ...initialGameSponsorshipFormState,
      gameId: "g",
      sponsorName: "n",
      sponsorEmail: "e@e.com",
      amount: "",
    };
    expect(buildGameSponsorshipPayload(state)).toBeNull();
  });

  it("builds a minimal payload with required fields only", () => {
    const state = {
      ...initialGameSponsorshipFormState,
      gameId: "g-1",
      sponsorName: "Acme",
      sponsorEmail: "a@b.com",
      amount: "30",
    };
    expect(buildGameSponsorshipPayload(state)).toEqual({
      gameId: "g-1",
      sponsorName: "Acme",
      sponsorEmail: "a@b.com",
      amountPence: 3000,
    });
  });

  it("includes optional fields only when set", () => {
    const state = {
      ...initialGameSponsorshipFormState,
      gameId: "g-1",
      sponsorName: "Acme",
      sponsorEmail: "a@b.com",
      amount: "10",
      website: "https://acme.example",
      phone: "01234",
      message: "Go team!",
      displayName: "Acme Ltd",
      notes: "VIP",
    };
    expect(buildGameSponsorshipPayload(state)).toEqual({
      gameId: "g-1",
      sponsorName: "Acme",
      sponsorEmail: "a@b.com",
      amountPence: 1000,
      sponsorWebsite: "https://acme.example",
      sponsorPhone: "01234",
      sponsorMessage: "Go team!",
      displayName: "Acme Ltd",
      notes: "VIP",
    });
  });
});

describe("playerSponsorshipFormReducer", () => {
  it("starts empty", () => {
    expect(initialPlayerSponsorshipFormState).toEqual({
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
    });
  });

  it("setPlayer updates slug + playerName together", () => {
    const next = playerSponsorshipFormReducer(
      initialPlayerSponsorshipFormState,
      { type: "setPlayer", slug: "alice", playerName: "Alice Smith" },
    );
    expect(next.slug).toBe("alice");
    expect(next.playerName).toBe("Alice Smith");
  });

  it("setField clamps message to 100 chars", () => {
    const long = "x".repeat(200);
    const next = playerSponsorshipFormReducer(
      initialPlayerSponsorshipFormState,
      { type: "setField", field: "message", value: long },
    );
    expect(next.message).toHaveLength(100);
  });

  it("reset returns to initial state", () => {
    const dirty: typeof initialPlayerSponsorshipFormState = {
      slug: "alice",
      playerName: "Alice",
      sponsorName: "n",
      sponsorEmail: "e@e.com",
      website: "",
      phone: "",
      message: "",
      amount: "10",
      displayName: "",
      notes: "",
    };
    expect(playerSponsorshipFormReducer(dirty, { type: "reset" })).toEqual(
      initialPlayerSponsorshipFormState,
    );
  });
});

describe("isPlayerSponsorshipReady", () => {
  const valid: typeof initialPlayerSponsorshipFormState = {
    ...initialPlayerSponsorshipFormState,
    slug: "alice",
    playerName: "Alice",
    sponsorName: "n",
    sponsorEmail: "e@e.com",
    amount: "25",
  };

  it("is true when slug, name, sponsor info and positive amount are set", () => {
    expect(isPlayerSponsorshipReady(valid)).toBe(true);
  });

  it("is false without slug or playerName", () => {
    expect(isPlayerSponsorshipReady({ ...valid, slug: "" })).toBe(false);
    expect(isPlayerSponsorshipReady({ ...valid, playerName: "" })).toBe(false);
  });

  it("is false when sponsorName or email is missing", () => {
    expect(isPlayerSponsorshipReady({ ...valid, sponsorName: "" })).toBe(false);
    expect(isPlayerSponsorshipReady({ ...valid, sponsorEmail: "" })).toBe(
      false,
    );
  });

  it("is false when amount is invalid", () => {
    expect(isPlayerSponsorshipReady({ ...valid, amount: "0" })).toBe(false);
    expect(isPlayerSponsorshipReady({ ...valid, amount: "-3" })).toBe(false);
    expect(isPlayerSponsorshipReady({ ...valid, amount: "" })).toBe(false);
  });
});

describe("buildPlayerSponsorshipPayload", () => {
  it("returns null when amount is invalid", () => {
    const state = {
      ...initialPlayerSponsorshipFormState,
      slug: "alice",
      playerName: "Alice",
      sponsorName: "n",
      sponsorEmail: "e@e.com",
      amount: "abc",
    };
    expect(buildPlayerSponsorshipPayload(state)).toBeNull();
  });

  it("builds a minimal payload with required fields only", () => {
    const state = {
      ...initialPlayerSponsorshipFormState,
      slug: "alice",
      playerName: "Alice",
      sponsorName: "n",
      sponsorEmail: "e@e.com",
      amount: "20",
    };
    expect(buildPlayerSponsorshipPayload(state)).toEqual({
      slug: "alice",
      playerName: "Alice",
      sponsorName: "n",
      sponsorEmail: "e@e.com",
      amountPence: 2000,
    });
  });

  it("includes optional fields only when set", () => {
    const state = {
      ...initialPlayerSponsorshipFormState,
      slug: "alice",
      playerName: "Alice",
      sponsorName: "n",
      sponsorEmail: "e@e.com",
      amount: "5.55",
      website: "https://x",
      phone: "0123",
      message: "go",
      displayName: "dn",
      notes: "nt",
    };
    expect(buildPlayerSponsorshipPayload(state)).toEqual({
      slug: "alice",
      playerName: "Alice",
      sponsorName: "n",
      sponsorEmail: "e@e.com",
      amountPence: 555,
      sponsorWebsite: "https://x",
      sponsorPhone: "0123",
      sponsorMessage: "go",
      displayName: "dn",
      notes: "nt",
    });
  });
});
