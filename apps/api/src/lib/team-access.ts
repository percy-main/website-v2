import type { DB } from "@percy-main/db";
import { hasClubWideAccess } from "@percy-main/shared/auth/permissions";
import type { Kysely } from "kysely";

/**
 * Returns the play_cricket_team IDs the user is allowed to access for
 * matchday/availability workflows. Club-wide roles (admins, matchday_admin)
 * get every team; scoped officials (the `official`/`junior_manager` roles)
 * get only the teams they are assigned to via team_official.
 *
 * Shared by the matchday and availability features so both gate on the same
 * team membership. Note this always hits the DB; callers that can cheaply
 * short-circuit the club-wide case (no team restriction) should check
 * `hasClubWideAccess` first.
 */
export async function getAccessibleTeamIds(
  db: Kysely<DB>,
  userId: string,
  role: string,
): Promise<string[]> {
  if (hasClubWideAccess(role, "matchday", "view")) {
    const allTeams = await db
      .selectFrom("play_cricket_team")
      .select("id")
      .execute();
    return allTeams.map((t) => t.id).filter((id): id is string => id !== null);
  }

  const assignments = await db
    .selectFrom("team_official")
    .where("user_id", "=", userId)
    .select("play_cricket_team_id")
    .execute();

  return assignments.map((a) => a.play_cricket_team_id);
}
