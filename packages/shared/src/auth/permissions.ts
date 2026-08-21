import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  userAc,
} from "better-auth/plugins/admin/access";

export const statements = {
  ...defaultStatements,
  incidents: ["view", "manage"],
  documents: ["manage"],
  marketing: ["view", "manage"],
  finance: ["view", "manage"],
  fantasy: ["manage"],
  matchday: ["view", "manage"],
  juniors: ["view", "manage"],
  ai_chat: ["use"],
  ai_scout: ["use"],
  ai_facts: ["view", "manage"],
  ai_knowledge: ["view", "manage"],
  // AI content-author assistant (the "Generate with AI" modal over the
  // content editor). Usage-only: it streams blocks into the client-side
  // draft; persistence still flows through the per-kind content gates on save.
  ai_content: ["use"],
  users: ["view", "manage", "manage_roles"],
  // Live content editing (#479). manage and publish are separate actions
  // deliberately - every role created today gets both (direct publish, no
  // review workflow), but keeping them distinct means a review tier can be
  // added later without a data migration. content_people is its own
  // resource because person profiles carry safeguarding-adjacent flags.
  content: ["view", "manage", "publish"],
  content_news: ["view", "manage", "publish"],
  content_reports: ["view", "manage", "publish"],
  content_people: ["view", "manage", "publish"],
} as const;

export const ac = createAccessControl(statements);

const ALL_PERMS = {
  ...adminAc.statements,
  incidents: ["view", "manage"],
  documents: ["manage"],
  marketing: ["view", "manage"],
  finance: ["view", "manage"],
  fantasy: ["manage"],
  matchday: ["view", "manage"],
  juniors: ["view", "manage"],
  ai_chat: ["use"],
  ai_scout: ["use"],
  ai_facts: ["view", "manage"],
  ai_knowledge: ["view", "manage"],
  ai_content: ["use"],
  users: ["view", "manage", "manage_roles"],
  content: ["view", "manage", "publish"],
  content_news: ["view", "manage", "publish"],
  content_reports: ["view", "manage", "publish"],
  content_people: ["view", "manage", "publish"],
} as const;

export const roles = {
  // Legacy kitchen-sink role — kept so existing admins keep working
  // until they're moved to narrower roles via the Access tab.
  admin: ac.newRole(ALL_PERMS),

  // Reuse better-auth's built-in empty userAc — newRole({}) confuses the
  // Subset<never, ...> inference and breaks the roles map type.
  user: userAc,

  // Incidents — safeguarding incident reports + contact inbox (welfare team)
  incidents_viewer: ac.newRole({ incidents: ["view"] }),
  incidents_admin: ac.newRole({ incidents: ["view", "manage"] }),

  // Documents — club document admin (policies, codes of conduct, etc.).
  // No viewer role: published documents are public; only management is gated.
  documents_admin: ac.newRole({ documents: ["manage"] }),

  // Marketing — outreach area: leads inbox, contact form submissions,
  // outbound email campaign queue.
  marketing_viewer: ac.newRole({ marketing: ["view"] }),
  marketing_admin: ac.newRole({ marketing: ["view", "manage"] }),

  // Finance — treasurer, charges, fee rates, sponsorships
  finance_viewer: ac.newRole({ finance: ["view"] }),
  finance_admin: ac.newRole({ finance: ["view", "manage"] }),

  // Fantasy — admin-only (play-fantasy itself is open to any authenticated
  // member, so no viewer role).
  fantasy_admin: ac.newRole({ fantasy: ["manage"] }),

  // Matchday — gameday admin, play-cricket sync, game reports, official availability
  matchday_viewer: ac.newRole({ matchday: ["view"] }),
  matchday_admin: ac.newRole({ matchday: ["view", "manage"] }),

  // Juniors — club-wide read/manage (per-team scoping stays on JuniorTeamManager)
  juniors_viewer: ac.newRole({ juniors: ["view"] }),
  juniors_admin: ac.newRole({ juniors: ["view", "manage"] }),

  // AI agent — chat + scout are usage-only, facts + knowledge gate the corpora
  ai_chat_user: ac.newRole({ ai_chat: ["use"] }),
  ai_scout_user: ac.newRole({ ai_scout: ["use"] }),
  ai_facts_viewer: ac.newRole({ ai_facts: ["view"] }),
  ai_facts_admin: ac.newRole({ ai_facts: ["view", "manage"] }),
  ai_knowledge_viewer: ac.newRole({ ai_knowledge: ["view"] }),
  ai_knowledge_admin: ac.newRole({ ai_knowledge: ["view", "manage"] }),

  // Content editing (#479). All roles get manage + publish (direct publish,
  // no review workflow - the editor pool is <5 trusted people). news_editor
  // also covers game reports: in practice the news volunteers write up
  // match coverage too.
  content_admin: ac.newRole({
    content: ["view", "manage", "publish"],
    content_news: ["view", "manage", "publish"],
    content_reports: ["view", "manage", "publish"],
    content_people: ["view", "manage", "publish"],
    ai_content: ["use"],
  }),
  news_editor: ac.newRole({
    content_news: ["view", "manage", "publish"],
    content_reports: ["view", "manage", "publish"],
    ai_content: ["use"],
  }),
  reports_editor: ac.newRole({
    content_reports: ["view", "manage", "publish"],
    ai_content: ["use"],
  }),
  people_editor: ac.newRole({
    content_people: ["view", "manage", "publish"],
    ai_content: ["use"],
  }),

  // Member management — same as admin's user CRUD minus the set-role power,
  // so a user_manager can archive/restore/link members but can't promote
  // anyone to a new role.
  user_manager: ac.newRole({
    user: [
      "create",
      "list",
      "ban",
      "impersonate",
      "delete",
      "set-password",
      "get",
      "update",
    ],
    session: ["list", "revoke", "delete"],
    users: ["view", "manage"],
  }),

  // Only role that can assign other roles. Inherits all of better-auth's
  // admin-plugin user actions (set-role, etc.).
  superadmin: ac.newRole({
    ...adminAc.statements,
    users: ["view", "manage", "manage_roles"],
  }),

  // Legacy scoped roles — preserved so today's flows keep working. They get
  // full matchday/juniors permissions; the per-team scoping (TeamOfficial,
  // JuniorTeamManager join tables) is still enforced in service-layer logic.
  junior_manager: ac.newRole({ juniors: ["view", "manage"] }),
  official: ac.newRole({ matchday: ["view", "manage"] }),
} as const;

export type RoleName = keyof typeof roles;

/** Roles surfaced in the admin Access tab UI (excludes default 'user'). */
export const ASSIGNABLE_ROLES: readonly RoleName[] = [
  "superadmin",
  "user_manager",
  "incidents_admin",
  "incidents_viewer",
  "documents_admin",
  "marketing_admin",
  "marketing_viewer",
  "finance_admin",
  "finance_viewer",
  "fantasy_admin",
  "matchday_admin",
  "matchday_viewer",
  "juniors_admin",
  "juniors_viewer",
  "ai_chat_user",
  "ai_scout_user",
  "ai_facts_admin",
  "ai_facts_viewer",
  "ai_knowledge_admin",
  "ai_knowledge_viewer",
  "content_admin",
  "news_editor",
  "reports_editor",
  "people_editor",
  "junior_manager",
  "official",
  "admin",
] as const;

export const ROLE_LABELS: Record<RoleName, string> = {
  admin: "Admin",
  user: "User",
  superadmin: "Superadmin",
  user_manager: "User manager",
  incidents_viewer: "Incidents viewer",
  incidents_admin: "Incidents admin",
  documents_admin: "Documents admin",
  marketing_viewer: "Marketing viewer",
  marketing_admin: "Marketing admin",
  finance_viewer: "Finance viewer",
  finance_admin: "Finance admin",
  fantasy_admin: "Fantasy admin",
  matchday_viewer: "Matchday viewer",
  matchday_admin: "Matchday admin",
  juniors_viewer: "Juniors viewer",
  juniors_admin: "Juniors admin",
  ai_chat_user: "AI chat",
  ai_scout_user: "AI scout",
  ai_facts_viewer: "AI facts viewer",
  ai_facts_admin: "AI facts admin",
  ai_knowledge_viewer: "AI knowledge viewer",
  ai_knowledge_admin: "AI knowledge admin",
  content_admin: "Content admin",
  news_editor: "News editor",
  reports_editor: "Reports editor",
  people_editor: "People editor",
  junior_manager: "Junior Manager",
  official: "Official",
};

export type Resource = keyof typeof statements;
export type Action<R extends Resource> = (typeof statements)[R][number];

/**
 * True iff the user holds any role other than the default `user`. Used to
 * gate access to the admin portal at the router level — individual tabs and
 * routes then check their own specific permission.
 */
export function hasAnyElevatedRole(
  rawRole: string | null | undefined,
): boolean {
  const userRoles = parseRoles(rawRole);
  return userRoles.some((r) => r !== "user");
}

/**
 * True iff the user has at least one permission that surfaces an admin-panel
 * sub-tab. Used to gate the "Admin Panel" links scattered around the
 * members/matchday/junior-manager/official areas, plus the /admin route
 * wrapper. AI-only roles (ai_chat_user, ai_scout_user, ai_facts_viewer,
 * ai_knowledge_viewer) intentionally do NOT qualify — they have access to
 * the Scout area instead. Keep this in sync with the per-sub-tab visibility
 * predicates in `apps/web/src/pages/admin/admin-panel.tsx`.
 */
export function hasAdminPanelAccess(
  rawRole: string | null | undefined,
): boolean {
  return (
    checkPermission(rawRole, "users", "view") ||
    checkPermission(rawRole, "users", "manage") ||
    checkPermission(rawRole, "users", "manage_roles") ||
    // Club-wide, matching the Juniors sub-tab's own gate (#627): a scoped
    // junior_manager has juniors:view but no admin-panel surface, so counting
    // it here would leave them on an empty /admin.
    hasClubWideAccess(rawRole, "juniors", "view") ||
    checkPermission(rawRole, "marketing", "view") ||
    checkPermission(rawRole, "finance", "view") ||
    checkPermission(rawRole, "finance", "manage") ||
    checkPermission(rawRole, "matchday", "view") ||
    checkPermission(rawRole, "fantasy", "manage") ||
    checkPermission(rawRole, "incidents", "view") ||
    checkPermission(rawRole, "documents", "manage") ||
    checkPermission(rawRole, "content", "view") ||
    checkPermission(rawRole, "content_news", "view") ||
    checkPermission(rawRole, "content_reports", "view") ||
    checkPermission(rawRole, "content_people", "view")
  );
}

/**
 * Parse a stored role string (comma-separated) into an array of role names.
 * Drops `user` because it's an implicit baseline, not a meaningful role:
 * letting it round-trip into UI state and back through saves bloats the
 * stored string with redundant entries.
 */
export function parseRoles(raw: string | null | undefined): RoleName[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((r) => r.trim())
    .filter((r): r is RoleName => r in roles && r !== "user");
}

/** Serialise an array of role names into the comma-separated storage format. */
export function serializeRoles(list: readonly RoleName[]): string {
  return list.join(",");
}

/**
 * Roles whose grants are scoped to a join table (TeamOfficial,
 * JuniorTeamManager) rather than club-wide. Used by service-layer code that
 * needs to distinguish "this user can see everything" from "this user can
 * only see the teams they're assigned to."
 */
export const SCOPED_ROLES: readonly RoleName[] = ["junior_manager", "official"];

/**
 * Check a single permission against a user's role(s). Resolves locally using
 * the shared roles map — no network call. Used by both FE hook and BE
 * middleware in their respective synchronous contexts.
 */
export function checkPermission<R extends Resource>(
  rawRole: string | null | undefined,
  resource: R,
  action: Action<R>,
): boolean {
  const userRoles = parseRoles(rawRole);
  for (const name of userRoles) {
    const role = roles[name];
    const stmt = (
      role.statements as Partial<Record<Resource, readonly string[]>>
    )[resource];
    if (stmt?.includes(action)) return true;
  }
  return false;
}

/**
 * Like checkPermission but only counts non-scoped roles. Returns true iff the
 * user has the permission via a club-wide role (e.g. matchday_admin, admin,
 * superadmin) rather than only via a legacy scoped role (official,
 * junior_manager). Service-layer scoping logic uses this to decide whether to
 * return all rows or filter to assigned-team rows.
 */
export function hasClubWideAccess<R extends Resource>(
  rawRole: string | null | undefined,
  resource: R,
  action: Action<R>,
): boolean {
  const userRoles = parseRoles(rawRole);
  for (const name of userRoles) {
    if (SCOPED_ROLES.includes(name)) continue;
    const role = roles[name];
    const stmt = (
      role.statements as Partial<Record<Resource, readonly string[]>>
    )[resource];
    if (stmt?.includes(action)) return true;
  }
  return false;
}
