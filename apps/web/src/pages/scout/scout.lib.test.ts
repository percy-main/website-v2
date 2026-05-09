import type { ReportData } from "@percy-main/shared";
import { describe, expect, it } from "vitest";
import {
  filterMessagesByRole,
  findInFlightReport,
  summariseAttachments,
  thinkingModeFromParam,
  viewFromParam,
} from "./scout.lib";

describe("viewFromParam", () => {
  it("returns 'chat' for null/undefined/empty", () => {
    expect(viewFromParam(null)).toBe("chat");
    expect(viewFromParam(undefined)).toBe("chat");
    expect(viewFromParam("")).toBe("chat");
  });

  it("returns 'chat' for unknown values", () => {
    expect(viewFromParam("nope")).toBe("chat");
  });

  it("maps known param values", () => {
    expect(viewFromParam("reports")).toBe("reports");
    expect(viewFromParam("facts")).toBe("facts");
    expect(viewFromParam("knowledge")).toBe("knowledge");
  });
});

describe("thinkingModeFromParam", () => {
  it("returns 'fast' only for the literal 'fast'", () => {
    expect(thinkingModeFromParam("fast")).toBe("fast");
  });

  it("returns 'thinking' for null/undefined/other strings", () => {
    expect(thinkingModeFromParam(null)).toBe("thinking");
    expect(thinkingModeFromParam(undefined)).toBe("thinking");
    expect(thinkingModeFromParam("")).toBe("thinking");
    expect(thinkingModeFromParam("slow")).toBe("thinking");
  });
});

describe("filterMessagesByRole", () => {
  const msgs: Array<{
    id: string;
    role: "user" | "assistant" | "tool" | "system";
  }> = [
    { id: "a", role: "user" },
    { id: "b", role: "tool" },
    { id: "c", role: "assistant" },
    { id: "d", role: "system" },
  ];

  it("keeps only user+assistant when those are the requested roles", () => {
    const out = filterMessagesByRole(msgs, ["user", "assistant"]);
    expect(out.map((m) => m.id)).toEqual(["a", "c"]);
  });

  it("returns empty for an empty role list", () => {
    expect(filterMessagesByRole(msgs, [])).toEqual([]);
  });

  it("preserves order", () => {
    const out = filterMessagesByRole(msgs, ["tool", "system"]);
    expect(out.map((m) => m.id)).toEqual(["b", "d"]);
  });
});

describe("summariseAttachments", () => {
  it("omits messages with no attachments", () => {
    const map = summariseAttachments([
      { id: "a", role: "user", parts: [], attachmentIds: [] },
      { id: "b", role: "user", parts: [], attachmentIds: ["x"] },
    ]);
    expect(map.has("a")).toBe(false);
    expect(map.get("b")).toEqual(["x"]);
  });

  it("returns an empty map for an empty input", () => {
    expect(summariseAttachments([]).size).toBe(0);
  });

  it("preserves attachment id order", () => {
    const map = summariseAttachments([
      { id: "m", role: "user", parts: [], attachmentIds: ["z", "y", "x"] },
    ]);
    expect(map.get("m")).toEqual(["z", "y", "x"]);
  });
});

describe("findInFlightReport", () => {
  const reportPart = (data: ReportData) => ({ type: "data-report", data });

  it("returns null for empty messages", () => {
    expect(findInFlightReport([])).toBeNull();
  });

  it("returns null when no report parts exist", () => {
    expect(
      findInFlightReport([
        { parts: [{ type: "text", text: "hi" }] },
        { parts: null },
      ]),
    ).toBeNull();
  });

  it("returns the most recent generating report", () => {
    const data: ReportData = {
      reportId: "r1",
      title: "t",
      fileSizeBytes: null,
      createdAt: "2026-01-01",
      status: "generating",
    };
    const out = findInFlightReport([{ parts: [reportPart(data)] }]);
    expect(out).toBe(data);
  });

  it("ignores 'generating' when a later terminal snapshot exists for the same reportId", () => {
    const generating: ReportData = {
      reportId: "r1",
      title: "t",
      fileSizeBytes: null,
      createdAt: "2026-01-01",
      status: "generating",
    };
    const ready: ReportData = { ...generating, status: "ready" };
    const out = findInFlightReport([
      { parts: [reportPart(generating)] },
      { parts: [reportPart(ready)] },
    ]);
    expect(out).toBeNull();
  });

  it("returns generating for a different reportId even when another is terminal", () => {
    const ready: ReportData = {
      reportId: "r1",
      title: "t",
      fileSizeBytes: null,
      createdAt: "2026-01-01",
      status: "ready",
    };
    const generating: ReportData = {
      reportId: "r2",
      title: "t",
      fileSizeBytes: null,
      createdAt: "2026-01-02",
      status: "generating",
    };
    const out = findInFlightReport([
      { parts: [reportPart(ready)] },
      { parts: [reportPart(generating)] },
    ]);
    expect(out).toBe(generating);
  });

  it("treats 'failed' as terminal", () => {
    const generating: ReportData = {
      reportId: "r1",
      title: "t",
      fileSizeBytes: null,
      createdAt: "2026-01-01",
      status: "generating",
    };
    const failed: ReportData = { ...generating, status: "failed" };
    const out = findInFlightReport([
      { parts: [reportPart(generating)] },
      { parts: [reportPart(failed)] },
    ]);
    expect(out).toBeNull();
  });

  it("ignores non-report parts", () => {
    const generating: ReportData = {
      reportId: "r1",
      title: "t",
      fileSizeBytes: null,
      createdAt: "2026-01-01",
      status: "generating",
    };
    const out = findInFlightReport([
      {
        parts: [
          { type: "text", text: "hi" },
          reportPart(generating),
          { type: "tool-call", id: "x" },
        ],
      },
    ]);
    expect(out).toBe(generating);
  });
});
