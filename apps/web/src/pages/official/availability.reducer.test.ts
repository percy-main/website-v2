import { describe, expect, it } from "vitest";
import {
  buildPreviewPayload,
  buildSendRecipients,
  initialNotifyFormState,
  notifyFormReducer,
  parseAdditionalEmails,
  type NotifyFormState,
  type NotifyRecipient,
} from "./availability.reducer";

const recipient = (
  email: string,
  source: NotifyRecipient["source"] = "filter",
  name: string | null = null,
): NotifyRecipient => ({ email, name, source });

describe("notifyFormReducer", () => {
  it("starts with empty filters and no preview", () => {
    expect(initialNotifyFormState).toEqual({
      memberCategory: "",
      membershipStatus: "",
      userGroupId: "",
      manualEmails: "",
      recipients: [],
      checked: new Set(),
      previewed: false,
    });
  });

  it("setMemberCategory leaves other filters alone", () => {
    const next = notifyFormReducer(initialNotifyFormState, {
      type: "setMemberCategory",
      value: "senior",
    });
    expect(next.memberCategory).toBe("senior");
    expect(next.membershipStatus).toBe("");
    expect(next.manualEmails).toBe("");
  });

  it("setMembershipStatus accepts active/lapsed", () => {
    const next = notifyFormReducer(initialNotifyFormState, {
      type: "setMembershipStatus",
      value: "active",
    });
    expect(next.membershipStatus).toBe("active");
  });

  it("previewSucceeded loads recipients and checks them all by default", () => {
    const recipients = [recipient("a@x"), recipient("b@x")];
    const next = notifyFormReducer(initialNotifyFormState, {
      type: "previewSucceeded",
      recipients,
    });
    expect(next.previewed).toBe(true);
    expect(next.recipients).toEqual(recipients);
    expect(next.checked).toEqual(new Set(["a@x", "b@x"]));
  });

  it("toggleRecipient removes a checked email", () => {
    const seeded: NotifyFormState = {
      ...initialNotifyFormState,
      recipients: [recipient("a@x"), recipient("b@x")],
      checked: new Set(["a@x", "b@x"]),
      previewed: true,
    };
    const next = notifyFormReducer(seeded, {
      type: "toggleRecipient",
      email: "a@x",
    });
    expect(next.checked).toEqual(new Set(["b@x"]));
  });

  it("toggleRecipient adds a previously-unchecked email", () => {
    const seeded: NotifyFormState = {
      ...initialNotifyFormState,
      recipients: [recipient("a@x"), recipient("b@x")],
      checked: new Set(["b@x"]),
      previewed: true,
    };
    const next = notifyFormReducer(seeded, {
      type: "toggleRecipient",
      email: "a@x",
    });
    expect(next.checked).toEqual(new Set(["a@x", "b@x"]));
  });

  it("toggleAll deselects everyone when all are selected", () => {
    const seeded: NotifyFormState = {
      ...initialNotifyFormState,
      recipients: [recipient("a@x"), recipient("b@x")],
      checked: new Set(["a@x", "b@x"]),
      previewed: true,
    };
    const next = notifyFormReducer(seeded, { type: "toggleAll" });
    expect(next.checked.size).toBe(0);
  });

  it("toggleAll selects everyone when some are unselected", () => {
    const seeded: NotifyFormState = {
      ...initialNotifyFormState,
      recipients: [recipient("a@x"), recipient("b@x"), recipient("c@x")],
      checked: new Set(["a@x"]),
      previewed: true,
    };
    const next = notifyFormReducer(seeded, { type: "toggleAll" });
    expect(next.checked).toEqual(new Set(["a@x", "b@x", "c@x"]));
  });

  it("toggleAll selects everyone when starting empty", () => {
    const seeded: NotifyFormState = {
      ...initialNotifyFormState,
      recipients: [recipient("a@x")],
      checked: new Set(),
      previewed: true,
    };
    const next = notifyFormReducer(seeded, { type: "toggleAll" });
    expect(next.checked).toEqual(new Set(["a@x"]));
  });

  it("reset clears everything", () => {
    const dirty: NotifyFormState = {
      memberCategory: "senior",
      membershipStatus: "active",
      userGroupId: "group-1",
      manualEmails: "x@x",
      recipients: [recipient("a@x")],
      checked: new Set(["a@x"]),
      previewed: true,
    };
    expect(notifyFormReducer(dirty, { type: "reset" })).toEqual(
      initialNotifyFormState,
    );
  });
});

describe("parseAdditionalEmails", () => {
  it("returns undefined for empty input", () => {
    expect(parseAdditionalEmails("")).toBeUndefined();
  });

  it("returns undefined when only whitespace/commas", () => {
    expect(parseAdditionalEmails(", ,  ")).toBeUndefined();
  });

  it("parses a single email", () => {
    expect(parseAdditionalEmails("a@example.com")).toEqual(["a@example.com"]);
  });

  it("trims and splits multiple emails", () => {
    expect(parseAdditionalEmails(" a@x , b@x , c@x")).toEqual([
      "a@x",
      "b@x",
      "c@x",
    ]);
  });

  it("drops empty entries between commas", () => {
    expect(parseAdditionalEmails("a@x,, b@x,")).toEqual(["a@x", "b@x"]);
  });
});

describe("buildPreviewPayload", () => {
  it("omits empty filters", () => {
    expect(buildPreviewPayload(initialNotifyFormState)).toEqual({
      memberCategory: undefined,
      membershipStatus: undefined,
      additionalEmails: undefined,
    });
  });

  it("includes filters when set", () => {
    const state: NotifyFormState = {
      ...initialNotifyFormState,
      memberCategory: "senior",
      membershipStatus: "active",
      manualEmails: "ad-hoc@x",
    };
    expect(buildPreviewPayload(state)).toEqual({
      memberCategory: "senior",
      membershipStatus: "active",
      additionalEmails: ["ad-hoc@x"],
    });
  });
});

describe("buildSendRecipients", () => {
  it("returns only the checked recipients with their names", () => {
    const state: NotifyFormState = {
      ...initialNotifyFormState,
      recipients: [
        recipient("a@x", "filter", "Alice"),
        recipient("b@x", "filter", "Bob"),
        recipient("c@x", "manual", null),
      ],
      checked: new Set(["a@x", "c@x"]),
      previewed: true,
    };
    expect(buildSendRecipients(state)).toEqual([
      { email: "a@x", name: "Alice" },
      { email: "c@x", name: null },
    ]);
  });

  it("returns an empty array when nothing is checked", () => {
    const state: NotifyFormState = {
      ...initialNotifyFormState,
      recipients: [recipient("a@x")],
      checked: new Set(),
      previewed: true,
    };
    expect(buildSendRecipients(state)).toEqual([]);
  });
});
