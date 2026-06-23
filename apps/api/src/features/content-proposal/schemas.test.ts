import { describe, expect, it } from "vitest";
import { rejectProposalSchema, submitProposalSchema } from "./schemas.ts";

const paragraph = (text: string) => ({
  id: crypto.randomUUID(),
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

const validPhoto = {
  sources: { "image/webp": "/uploads/me.webp 1x" },
  img: { src: "/uploads/me.png", w: 200, h: 200 },
};

describe("submitProposalSchema (self-editable field subset)", () => {
  it("accepts a body with a site-relative photo", () => {
    const result = submitProposalSchema.safeParse({
      body: [paragraph("My new bio")],
      photo: validPhoto,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a body with the photo removed (null)", () => {
    const result = submitProposalSchema.safeParse({
      body: [paragraph("Just text")],
      photo: null,
    });
    expect(result.success).toBe(true);
  });

  it("requires the body", () => {
    const result = submitProposalSchema.safeParse({ photo: null });
    expect(result.success).toBe(false);
  });

  it("requires the photo key (null or a photo, never omitted)", () => {
    const result = submitProposalSchema.safeParse({
      body: [paragraph("hi")],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a photo whose image is not https or site-relative", () => {
    const result = submitProposalSchema.safeParse({
      body: [paragraph("hi")],
      photo: {
        sources: { "image/webp": "http://evil.example/me.webp 1x" },
        img: { src: "http://evil.example/me.png", w: 200, h: 200 },
      },
    });
    expect(result.success).toBe(false);
  });

  it("strips admin-only fields a client tries to smuggle in (title, flags, slug)", () => {
    // The owner can only ever change bio + photo. Zod drops unknown keys, so
    // even a hand-crafted request carrying title/slug/safeguarding flags
    // reaches the service as just { body, photo }.
    const result = submitProposalSchema.safeParse({
      body: [paragraph("hi")],
      photo: null,
      title: "Hacked Name",
      slug: "somewhere-else",
      isDBSChecked: true,
      hasLeftClub: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data).sort()).toEqual(["body", "photo"]);
    }
  });
});

describe("rejectProposalSchema", () => {
  it("allows no body (a bare reject with no note)", () => {
    expect(rejectProposalSchema.safeParse(undefined).success).toBe(true);
    expect(rejectProposalSchema.safeParse({}).success).toBe(true);
  });

  it("allows a decision note", () => {
    expect(
      rejectProposalSchema.safeParse({ note: "Please shorten the bio" })
        .success,
    ).toBe(true);
  });

  it("rejects an over-long note", () => {
    expect(
      rejectProposalSchema.safeParse({ note: "x".repeat(2001) }).success,
    ).toBe(false);
  });
});
