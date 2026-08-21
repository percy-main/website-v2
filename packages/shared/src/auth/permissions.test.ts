import { describe, expect, it } from "vitest";

import {
  ASSIGNABLE_ROLES,
  checkPermission,
  hasAdminPanelAccess,
  hasAnyElevatedRole,
  hasClubWideAccess,
  ROLE_LABELS,
  roles,
  SCOPED_ROLES,
  type Action,
  type Resource,
} from "./permissions.js";

const CONTENT_RESOURCES = [
  "content",
  "content_news",
  "content_reports",
  "content_people",
] satisfies Resource[];

const CONTENT_ACTIONS = ["view", "manage", "publish"] satisfies Array<
  Action<"content">
>;

describe("content roles", () => {
  it("content_admin has every action on every content resource", () => {
    for (const resource of CONTENT_RESOURCES) {
      for (const action of CONTENT_ACTIONS) {
        expect(checkPermission("content_admin", resource, action)).toBe(true);
      }
    }
  });

  it("news_editor covers news and reports but not pages or people", () => {
    for (const action of CONTENT_ACTIONS) {
      expect(checkPermission("news_editor", "content_news", action)).toBe(true);
      expect(checkPermission("news_editor", "content_reports", action)).toBe(
        true,
      );
      expect(checkPermission("news_editor", "content", action)).toBe(false);
      expect(checkPermission("news_editor", "content_people", action)).toBe(
        false,
      );
    }
  });

  it("reports_editor covers reports only", () => {
    for (const action of CONTENT_ACTIONS) {
      expect(checkPermission("reports_editor", "content_reports", action)).toBe(
        true,
      );
      expect(checkPermission("reports_editor", "content", action)).toBe(false);
      expect(checkPermission("reports_editor", "content_news", action)).toBe(
        false,
      );
      expect(checkPermission("reports_editor", "content_people", action)).toBe(
        false,
      );
    }
  });

  it("people_editor covers people only", () => {
    for (const action of CONTENT_ACTIONS) {
      expect(checkPermission("people_editor", "content_people", action)).toBe(
        true,
      );
      expect(checkPermission("people_editor", "content", action)).toBe(false);
      expect(checkPermission("people_editor", "content_news", action)).toBe(
        false,
      );
      expect(checkPermission("people_editor", "content_reports", action)).toBe(
        false,
      );
    }
  });

  it("legacy admin keeps the kitchen-sink invariant for content", () => {
    for (const resource of CONTENT_RESOURCES) {
      for (const action of CONTENT_ACTIONS) {
        expect(checkPermission("admin", resource, action)).toBe(true);
      }
    }
  });

  it("unrelated roles get no content access", () => {
    for (const resource of CONTENT_RESOURCES) {
      expect(checkPermission("matchday_admin", resource, "view")).toBe(false);
      expect(checkPermission("finance_admin", resource, "manage")).toBe(false);
      expect(checkPermission(null, resource, "view")).toBe(false);
    }
  });

  it("content roles work in comma-separated multi-role strings", () => {
    expect(
      checkPermission("user,reports_editor", "content_reports", "publish"),
    ).toBe(true);
    expect(
      checkPermission(
        "matchday_viewer,people_editor",
        "content_people",
        "manage",
      ),
    ).toBe(true);
  });

  it("every content role grants admin panel access via its view permission", () => {
    expect(hasAdminPanelAccess("content_admin")).toBe(true);
    expect(hasAdminPanelAccess("news_editor")).toBe(true);
    expect(hasAdminPanelAccess("reports_editor")).toBe(true);
    expect(hasAdminPanelAccess("people_editor")).toBe(true);
  });

  it("content roles are assignable and labelled", () => {
    for (const role of [
      "content_admin",
      "news_editor",
      "reports_editor",
      "people_editor",
    ] as const) {
      expect(ASSIGNABLE_ROLES).toContain(role);
      expect(ROLE_LABELS[role]).toBeTruthy();
      expect(roles[role]).toBeDefined();
    }
  });
});

describe("club-wide vs team-scoped access (#627)", () => {
  it("hasClubWideAccess ignores the scoped roles", () => {
    for (const role of SCOPED_ROLES) {
      expect(hasAnyElevatedRole(role)).toBe(true);
    }

    // junior_manager and official hold the permission, but only per-team.
    expect(checkPermission("junior_manager", "juniors", "view")).toBe(true);
    expect(hasClubWideAccess("junior_manager", "juniors", "view")).toBe(false);
    expect(checkPermission("official", "matchday", "manage")).toBe(true);
    expect(hasClubWideAccess("official", "matchday", "manage")).toBe(false);

    // Club-wide equivalents are unaffected.
    expect(hasClubWideAccess("juniors_admin", "juniors", "manage")).toBe(true);
    expect(hasClubWideAccess("matchday_admin", "matchday", "manage")).toBe(
      true,
    );
    expect(hasClubWideAccess("admin", "juniors", "view")).toBe(true);
  });

  it("a scoped role does not mask a club-wide one held alongside it", () => {
    expect(hasClubWideAccess("official,juniors_admin", "juniors", "view")).toBe(
      true,
    );
    expect(
      hasClubWideAccess("junior_manager,official", "juniors", "view"),
    ).toBe(false);
  });

  it("junior_manager alone no longer counts as admin-panel access", () => {
    // The Juniors sub-tab is its only surface and that is now club-wide
    // only, so counting it would land them on an empty /admin.
    expect(hasAdminPanelAccess("junior_manager")).toBe(false);
    expect(hasAdminPanelAccess("juniors_viewer")).toBe(true);
    expect(hasAdminPanelAccess("juniors_admin")).toBe(true);

    // `official` keeps its (team-filtered) Game Reports sub-tab.
    expect(hasAdminPanelAccess("official")).toBe(true);
    expect(hasAdminPanelAccess("junior_manager,official")).toBe(true);
  });
});
