import { describe, expect, it } from "vitest";
import { project } from "./projector.ts";

describe("project", () => {
  it("keeps a single top-level scalar", () => {
    const out = project({ result: "won by 5", other: "x" }, ["result"]);
    expect(out).toEqual({ result: "won by 5" });
  });

  it("walks nested object paths", () => {
    const out = project({ a: { b: { c: 1, d: 2 } } }, ["a.b.c"]);
    expect(out).toEqual({ a: { b: { c: 1 } } });
  });

  it("projects each element of an array with foo[].bar", () => {
    const out = project(
      {
        matches: [
          { id: 1, name: "x", drop: true },
          { id: 2, name: "y" },
        ],
      },
      ["matches[].id"],
    );
    expect(out).toEqual({ matches: [{ id: 1 }, { id: 2 }] });
  });

  it("unions multiple sibling paths on the same array element", () => {
    const out = project(
      {
        matches: [
          { id: 1, date: "2025-05-01", drop: true },
          { id: 2, date: "2025-05-08" },
        ],
      },
      ["matches[].id", "matches[].date"],
    );
    expect(out).toEqual({
      matches: [
        { id: 1, date: "2025-05-01" },
        { id: 2, date: "2025-05-08" },
      ],
    });
  });

  it("supports nested arrays inside arrays", () => {
    const source = {
      innings: [
        {
          team: "Percy Main",
          runs: 200,
          bat: [
            { name: "A", runs: 50, balls: 60 },
            { name: "B", runs: 30, balls: 40 },
          ],
        },
      ],
    };
    const out = project(source, [
      "innings[].team",
      "innings[].bat[].name",
      "innings[].bat[].runs",
    ]);
    expect(out).toEqual({
      innings: [
        {
          team: "Percy Main",
          bat: [
            { name: "A", runs: 50 },
            { name: "B", runs: 30 },
          ],
        },
      ],
    });
  });

  it("foo[] without a trailing path keeps the whole array as-is", () => {
    const out = project({ items: [{ a: 1 }, { a: 2 }] }, ["items[]"]);
    expect(out).toEqual({ items: [{ a: 1 }, { a: 2 }] });
  });

  it("silently drops paths whose intermediate keys do not exist", () => {
    const out = project({ a: 1 }, ["b.c", "a"]);
    expect(out).toEqual({ a: 1 });
  });

  it("returns null when no requested path matched", () => {
    const out = project({ a: 1 }, ["b", "c"]);
    expect(out).toBeNull();
  });

  it("preserves nulls in source data (does not coerce to undefined)", () => {
    const out = project({ a: { b: null as unknown } }, ["a.b"]);
    expect(out).toEqual({ a: { b: null } });
  });

  it("ignores path segments that point at non-array via [] notation", () => {
    // foo is a string, but model asked foo[] — treat as miss, don't crash.
    const out = project({ foo: "not-an-array", bar: 1 }, ["foo[].x", "bar"]);
    expect(out).toEqual({ bar: 1 });
  });
});
