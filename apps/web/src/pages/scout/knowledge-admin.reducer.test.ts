import { describe, expect, it } from "vitest";
import {
  initialUploadFormState,
  parseTags,
  uploadFormReducer,
  type UploadFormState,
} from "./knowledge-admin.reducer";

describe("uploadFormReducer", () => {
  it("starts with empty fields and not busy", () => {
    expect(initialUploadFormState).toEqual({
      file: null,
      title: "",
      description: "",
      tagsRaw: "",
      error: null,
      busy: false,
    });
  });

  it("setTitle updates only title", () => {
    const next = uploadFormReducer(initialUploadFormState, {
      type: "setTitle",
      value: "League handbook",
    });
    expect(next.title).toBe("League handbook");
    expect(next.tagsRaw).toBe("");
    expect(next.busy).toBe(false);
  });

  it("setDescription updates only description", () => {
    const next = uploadFormReducer(initialUploadFormState, {
      type: "setDescription",
      value: "Annual rules.",
    });
    expect(next.description).toBe("Annual rules.");
    expect(next.title).toBe("");
  });

  it("setTagsRaw updates only tagsRaw", () => {
    const next = uploadFormReducer(initialUploadFormState, {
      type: "setTagsRaw",
      value: "topic:rules",
    });
    expect(next.tagsRaw).toBe("topic:rules");
  });

  it("setError + setBusy compose without losing other fields", () => {
    const dirty: UploadFormState = {
      file: null,
      title: "Doc",
      description: "Desc",
      tagsRaw: "k:v",
      error: null,
      busy: false,
    };
    const errored = uploadFormReducer(dirty, {
      type: "setError",
      value: "Boom",
    });
    expect(errored.error).toBe("Boom");
    expect(errored.title).toBe("Doc");
    const busy = uploadFormReducer(errored, { type: "setBusy", value: true });
    expect(busy.busy).toBe(true);
    expect(busy.error).toBe("Boom");
  });

  it("reset returns to the initial state", () => {
    const dirty: UploadFormState = {
      file: null,
      title: "Doc",
      description: "Desc",
      tagsRaw: "k:v",
      error: "Boom",
      busy: true,
    };
    expect(uploadFormReducer(dirty, { type: "reset" })).toEqual(
      initialUploadFormState,
    );
  });

  it("setFile accepts null to clear", () => {
    const withFile = uploadFormReducer(initialUploadFormState, {
      type: "setFile",
      // We use a tiny stub rather than constructing a real File for jsdom.
      value: { name: "x" } as unknown as File,
    });
    expect(withFile.file).not.toBeNull();
    const cleared = uploadFormReducer(withFile, {
      type: "setFile",
      value: null,
    });
    expect(cleared.file).toBeNull();
  });
});

describe("parseTags", () => {
  it("returns an empty object for empty input", () => {
    expect(parseTags("")).toEqual({});
    expect(parseTags("   ")).toEqual({});
  });

  it("parses a single key:value pair", () => {
    expect(parseTags("topic:rules")).toEqual({ topic: "rules" });
  });

  it("parses multiple comma-separated pairs", () => {
    expect(parseTags("topic:rules, season:2026")).toEqual({
      topic: "rules",
      season: "2026",
    });
  });

  it("collects repeated keys into an array", () => {
    expect(parseTags("topic:rules, topic:bowling")).toEqual({
      topic: ["rules", "bowling"],
    });
  });

  it("appends a third value to an existing array", () => {
    expect(parseTags("t:a, t:b, t:c")).toEqual({
      t: ["a", "b", "c"],
    });
  });

  it("trims whitespace around keys and values", () => {
    expect(parseTags("  topic  :  rules  ")).toEqual({ topic: "rules" });
  });

  it("drops entries without a colon", () => {
    expect(parseTags("loose, topic:rules")).toEqual({ topic: "rules" });
  });

  it("drops entries with an empty key", () => {
    expect(parseTags(":value, topic:rules")).toEqual({ topic: "rules" });
  });

  it("drops entries with an empty value", () => {
    expect(parseTags("topic:, season:2026")).toEqual({ season: "2026" });
  });

  it("preserves colons inside the value", () => {
    expect(parseTags("url:https://example.com")).toEqual({
      url: "https://example.com",
    });
  });

  it("ignores empty segments between commas", () => {
    expect(parseTags("topic:rules, , season:2026")).toEqual({
      topic: "rules",
      season: "2026",
    });
  });
});
