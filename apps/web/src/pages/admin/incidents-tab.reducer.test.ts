import { describe, expect, it } from "vitest";
import {
  buildIncidentPayload,
  fromDateInput,
  fromDateTimeLocal,
  incidentEditReducer,
  initialIncidentEditState,
  toDateInput,
  toDateTimeLocal,
  type IncidentEditFormState,
  type IncidentInitial,
} from "./incidents-tab.reducer";

const baseInitial: IncidentInitial = {
  status: "new",
  severity: null,
  internalNotes: null,
  actionsTaken: null,
  targetCompletionDate: null,
  riddorRequired: null,
  riddorReportedAt: null,
  closureReason: null,
  closedAt: null,
  safeguardingDiscussed: false,
  safeguardingDiscussedAt: null,
  safeguardingNotes: null,
};

describe("toDateInput / fromDateInput", () => {
  it("returns empty string for null / undefined / empty", () => {
    expect(toDateInput(null)).toBe("");
    expect(toDateInput(undefined)).toBe("");
    expect(toDateInput("")).toBe("");
  });

  it("returns empty string for unparseable input", () => {
    expect(toDateInput("not-a-date")).toBe("");
  });

  it("formats an ISO date as yyyy-mm-dd in local time", () => {
    // Use a midday UTC time so it doesn't shift across timezones for
    // most of the world.
    const formatted = toDateInput("2024-06-15T12:00:00.000Z");
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatted.startsWith("2024-")).toBe(true);
  });

  it("round-trips through fromDateInput", () => {
    const iso = fromDateInput("2024-06-15");
    expect(iso).not.toBeNull();
    expect(toDateInput(iso)).toBe("2024-06-15");
  });

  it("fromDateInput returns null for blank / invalid", () => {
    expect(fromDateInput("")).toBeNull();
    expect(fromDateInput("garbage")).toBeNull();
  });
});

describe("toDateTimeLocal / fromDateTimeLocal", () => {
  it("returns empty string for null / unparseable", () => {
    expect(toDateTimeLocal(null)).toBe("");
    expect(toDateTimeLocal("nope")).toBe("");
  });

  it("formats an ISO date as yyyy-mm-ddThh:mm", () => {
    const out = toDateTimeLocal("2024-06-15T12:34:00.000Z");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("round-trips at minute precision", () => {
    const formatted = toDateTimeLocal("2024-06-15T12:34:00.000Z");
    const back = fromDateTimeLocal(formatted);
    expect(back).not.toBeNull();
    expect(toDateTimeLocal(back)).toBe(formatted);
  });

  it("fromDateTimeLocal returns null for blank / invalid", () => {
    expect(fromDateTimeLocal("")).toBeNull();
    expect(fromDateTimeLocal("nope")).toBeNull();
  });
});

describe("initialIncidentEditState", () => {
  it("maps all-null record to empty / unset defaults", () => {
    expect(initialIncidentEditState(baseInitial)).toEqual({
      status: "new",
      severity: "unset",
      internalNotes: "",
      actionsTaken: "",
      targetCompletionDate: "",
      riddorRequired: "unset",
      riddorReportedAt: "",
      closureReason: "",
      closedAt: "",
      safeguardingDiscussed: false,
      safeguardingDiscussedAt: "",
      safeguardingNotes: "",
    });
  });

  it("maps riddorRequired=true → 'yes' and severity to its literal", () => {
    const state = initialIncidentEditState({
      ...baseInitial,
      severity: "high",
      riddorRequired: true,
    });
    expect(state.severity).toBe("high");
    expect(state.riddorRequired).toBe("yes");
  });

  it("maps riddorRequired=false → 'no'", () => {
    const state = initialIncidentEditState({
      ...baseInitial,
      riddorRequired: false,
    });
    expect(state.riddorRequired).toBe("no");
  });

  it("preserves text fields verbatim", () => {
    const state = initialIncidentEditState({
      ...baseInitial,
      internalNotes: "  needs follow-up  ",
      actionsTaken: "first aid given",
    });
    expect(state.internalNotes).toBe("  needs follow-up  ");
    expect(state.actionsTaken).toBe("first aid given");
  });
});

describe("incidentEditReducer", () => {
  const fresh = (): IncidentEditFormState =>
    initialIncidentEditState(baseInitial);

  it("setStatus updates only status", () => {
    const next = incidentEditReducer(fresh(), {
      type: "setStatus",
      value: "in_review",
    });
    expect(next.status).toBe("in_review");
    expect(next.severity).toBe("unset");
  });

  it("setSeverity updates only severity", () => {
    const next = incidentEditReducer(fresh(), {
      type: "setSeverity",
      value: "high",
    });
    expect(next.severity).toBe("high");
    expect(next.status).toBe("new");
  });

  it("setRiddorRequired flips between unset/yes/no", () => {
    let s = incidentEditReducer(fresh(), {
      type: "setRiddorRequired",
      value: "yes",
    });
    expect(s.riddorRequired).toBe("yes");
    s = incidentEditReducer(s, { type: "setRiddorRequired", value: "no" });
    expect(s.riddorRequired).toBe("no");
    s = incidentEditReducer(s, { type: "setRiddorRequired", value: "unset" });
    expect(s.riddorRequired).toBe("unset");
  });

  it("setSafeguardingDiscussed toggles boolean field", () => {
    const on = incidentEditReducer(fresh(), {
      type: "setSafeguardingDiscussed",
      value: true,
    });
    expect(on.safeguardingDiscussed).toBe(true);
    const off = incidentEditReducer(on, {
      type: "setSafeguardingDiscussed",
      value: false,
    });
    expect(off.safeguardingDiscussed).toBe(false);
  });

  it("text setters store free text without trimming", () => {
    const next = incidentEditReducer(fresh(), {
      type: "setInternalNotes",
      value: "  hello  ",
    });
    expect(next.internalNotes).toBe("  hello  ");
  });

  it("returns a new object reference (no in-place mutation)", () => {
    const before = fresh();
    const after = incidentEditReducer(before, {
      type: "setActionsTaken",
      value: "x",
    });
    expect(after).not.toBe(before);
    expect(before.actionsTaken).toBe("");
  });
});

describe("buildIncidentPayload", () => {
  it("collapses unset enums and whitespace text to null", () => {
    const state = initialIncidentEditState(baseInitial);
    const payload = buildIncidentPayload({
      ...state,
      internalNotes: "   ",
      actionsTaken: "",
      closureReason: "  \t ",
      safeguardingNotes: "",
    });
    expect(payload).toEqual({
      status: "new",
      severity: null,
      actionsTaken: null,
      targetCompletionDate: null,
      riddorRequired: null,
      riddorReportedAt: null,
      internalNotes: null,
      closureReason: null,
      closedAt: null,
      safeguardingDiscussed: false,
      safeguardingDiscussedAt: null,
      safeguardingNotes: null,
    });
  });

  it("translates riddorRequired tri-state to boolean | null", () => {
    const base = initialIncidentEditState(baseInitial);

    expect(
      buildIncidentPayload({ ...base, riddorRequired: "yes" }),
    ).toMatchObject({ riddorRequired: true });
    expect(
      buildIncidentPayload({ ...base, riddorRequired: "no" }),
    ).toMatchObject({ riddorRequired: false });
    expect(
      buildIncidentPayload({ ...base, riddorRequired: "unset" }),
    ).toMatchObject({ riddorRequired: null });
  });

  it("trims text fields and keeps non-empty content", () => {
    const base = initialIncidentEditState(baseInitial);
    const payload = buildIncidentPayload({
      ...base,
      actionsTaken: "  did stuff  ",
      internalNotes: "see below",
      closureReason: "duplicate",
    });
    expect(payload.actionsTaken).toBe("did stuff");
    expect(payload.internalNotes).toBe("see below");
    expect(payload.closureReason).toBe("duplicate");
  });

  it("converts date inputs back to ISO timestamps", () => {
    const base = initialIncidentEditState(baseInitial);
    const payload = buildIncidentPayload({
      ...base,
      targetCompletionDate: "2024-06-15",
    });
    expect(payload.targetCompletionDate).not.toBeNull();
    expect(typeof payload.targetCompletionDate).toBe("string");
    expect(payload.targetCompletionDate).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("preserves a non-unset severity literal", () => {
    const base = initialIncidentEditState(baseInitial);
    const payload = buildIncidentPayload({
      ...base,
      severity: "medium",
      status: "done",
    });
    expect(payload.severity).toBe("medium");
    expect(payload.status).toBe("done");
  });
});
