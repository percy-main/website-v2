import { describe, expect, it } from "vitest";
import { parseGalleryImages } from "./photo-gallery.js";

const picture = (id: string) => ({
  sources: {
    webp: `/uploads/content/${id}/320.webp 320w, /uploads/content/${id}/640.webp 640w`,
  },
  img: { src: `/uploads/content/${id}/640.jpg`, w: 640, h: 480 },
});

describe("parseGalleryImages", () => {
  it("parses a valid images array, dropping empty alt/caption", () => {
    const parsed = parseGalleryImages(
      JSON.stringify([
        { picture: picture("a"), alt: "The winning six", caption: "Scenes" },
        { picture: picture("b"), alt: "", caption: "" },
      ]),
    );
    expect(parsed).toEqual([
      {
        picture: picture("a"),
        alt: "The winning six",
        caption: "Scenes",
      },
      { picture: picture("b") },
    ]);
  });

  it("strips unknown keys from stored descriptors", () => {
    const parsed = parseGalleryImages(
      JSON.stringify([{ picture: { ...picture("a"), extra: "junk" } }]),
    );
    expect(parsed).toEqual([{ picture: picture("a") }]);
  });

  it("returns null for absent, malformed or empty input", () => {
    expect(parseGalleryImages(undefined)).toBeNull();
    expect(parseGalleryImages("")).toBeNull();
    expect(parseGalleryImages("not json")).toBeNull();
    expect(parseGalleryImages('{"picture":{}}')).toBeNull();
    expect(parseGalleryImages("[]")).toBeNull();
  });

  it("rejects the whole gallery when any entry is invalid", () => {
    for (const bad of [
      { alt: "no picture" },
      { picture: { sources: {}, img: { src: "/x.jpg", w: 1 } } }, // no h
      { picture: { sources: { webp: 5 }, img: { src: "/x.jpg", w: 1, h: 1 } } },
      { picture: picture("a"), alt: 7 },
      { picture: picture("a"), caption: false },
    ]) {
      expect(
        parseGalleryImages(JSON.stringify([{ picture: picture("ok") }, bad])),
      ).toBeNull();
    }
  });

  it("rejects unsafe image urls anywhere in a descriptor", () => {
    const unsafeImg = {
      picture: {
        sources: {},
        img: { src: "javascript:alert(1)", w: 1, h: 1 },
      },
    };
    const unsafeSrcset = {
      picture: {
        sources: { webp: "javascript:alert(1) 320w" },
        img: { src: "/uploads/content/a/640.jpg", w: 640, h: 480 },
      },
    };
    const plainHttp = {
      picture: {
        sources: {},
        img: { src: "http://example.com/pixel.gif", w: 1, h: 1 },
      },
    };
    for (const bad of [unsafeImg, unsafeSrcset, plainHttp]) {
      expect(parseGalleryImages(JSON.stringify([bad]))).toBeNull();
    }
  });

  it("keeps alt and caption verbatim (no trimming mid-typing)", () => {
    const parsed = parseGalleryImages(
      JSON.stringify([{ picture: picture("a"), caption: "Half a caption " }]),
    );
    expect(parsed?.[0]?.caption).toBe("Half a caption ");
  });
});
