import type { DB } from "@percy-main/db";
import {
  getAgeGroup,
  getTeamName,
  nameSimilarity,
  normalizeName,
} from "@percy-main/shared";
import {
  parseRoles,
  serializeRoles,
} from "@percy-main/shared/auth/permissions";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { closeReliefForArchivedMember } from "../financial-relief/service.ts";
import type {
  AddMatchFeeRate,
  ChargeAggregates,
  CreateCharge,
  CreateMember,
  LinkDependent,
  LinkParent,
  ListCharges,
  ListContactSubmissions,
  ListJuniors,
  ListUsers,
  MergeMembers,
  MergePreview,
  RecordLinking,
  SearchMembersForParentLink,
  SearchUsersForAccess,
  SearchUsersForLinking,
  Unlink,
  UnlinkDependent,
  UnlinkParent,
  UpdateAccessAssignments,
  UpdateUser,
} from "./schemas.ts";

export function listUsers(db: Kysely<DB>) {
  return async (params: ListUsers) => {
    const { page, pageSize, search, includeArchived, role } = params;
    const offset = (page - 1) * pageSize;

    let query = db
      .selectFrom("user")
      .leftJoin("member", "member.email", "user.email")
      .leftJoin(
        (eb) =>
          eb
            .selectFrom("membership")
            .select([
              "membership.member_id",
              "membership.id",
              "membership.type",
              "membership.paid_until",
            ])
            .distinctOn("membership.member_id")
            .orderBy("membership.member_id")
            .orderBy("membership.paid_until", "desc")
            .as("membership"),
        (join) => join.onRef("membership.member_id", "=", "member.id"),
      );

    if (!includeArchived) {
      query = query.where((eb) =>
        eb.or([eb("user.banned", "=", false), eb("user.banned", "is", null)]),
      );
    }

    if (search) {
      const pattern = `%${search}%`;
      query = query.where((eb) =>
        eb.or([
          eb("user.name", "ilike", pattern),
          eb("user.email", "ilike", pattern),
        ]),
      );
    }

    if (role) {
      query = query.where("user.role", "=", role);
    }

    if (params.memberCategory) {
      query = query.where("member.member_category", "=", params.memberCategory);
    }

    if (params.isMember !== undefined) {
      if (params.isMember) {
        query = query.where("member.id", "is not", null);
      } else {
        query = query.where("member.id", "is", null);
      }
    }

    if (params.membershipStatus) {
      const now = new Date().toISOString();
      if (params.membershipStatus === "active") {
        query = query.where("membership.paid_until", ">", now);
      } else if (params.membershipStatus === "lapsed") {
        query = query
          .where("membership.paid_until", "is not", null)
          .where("membership.paid_until", "<=", now);
      } else if (params.membershipStatus === "none") {
        query = query.where("membership.id", "is", null);
      }
    }

    if (params.membershipType) {
      query = query.where("membership.type", "=", params.membershipType);
    }

    const [items, countResult] = await Promise.all([
      query
        .select([
          "user.id",
          "user.name",
          "user.email",
          "user.role",
          "user.banned",
          "user.emailVerified",
          "user.createdAt",
          "member.id as memberId",
          "member.member_category",
          "member.deleted_at as memberDeletedAt",
          "member.deleted_reason as memberDeletedReason",
          "membership.type as membershipType",
          "membership.paid_until as membershipPaidUntil",
        ])
        .orderBy("user.createdAt", "desc")
        .limit(pageSize)
        .offset(offset)
        .execute(),
      query.select(db.fn.countAll().as("total")).executeTakeFirst(),
    ]);

    return {
      items,
      total: Number(countResult?.total ?? 0),
      page,
      pageSize,
    };
  };
}

export function updateUser(db: Kysely<DB>) {
  return async (userId: string, data: UpdateUser) => {
    if (Object.values(data).filter((v) => v !== undefined).length > 0) {
      await db.updateTable("user").set(data).where("id", "=", userId).execute();
    }

    return { success: true };
  };
}

export function createMember(db: Kysely<DB>) {
  return async (data: CreateMember) => {
    const id = crypto.randomUUID();

    await db
      .insertInto("member")
      .values({
        id,
        email: data.email,
        name: data.name ?? null,
        title: data.title ?? null,
        member_category: data.memberCategory ?? null,
      })
      .execute();

    return { id };
  };
}

export function sendChargeNotification(db: Kysely<DB>) {
  return async (userId: string) => {
    const user = await db
      .selectFrom("user")
      .where("id", "=", userId)
      .select(["email", "name"])
      .executeTakeFirst();

    if (!user) {
      const error = new Error("User not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    const member = await db
      .selectFrom("member")
      .where("email", "=", user.email)
      .select("id")
      .executeTakeFirst();

    if (!member) {
      const error = new Error("No member record found for user") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    const unpaidCharges = await db
      .selectFrom("charge")
      .where("member_id", "=", member.id)
      .where("paid_at", "is", null)
      .where("payment_confirmed_at", "is", null)
      .where("deleted_at", "is", null)
      .where("relieved_at", "is", null)
      .selectAll()
      .execute();

    if (unpaidCharges.length === 0) {
      return { sent: false, reason: "No outstanding charges" };
    }

    // TODO: Send email notification via email service
    return { sent: true, chargeCount: unpaidCharges.length };
  };
}

export function getRecordLinking(db: Kysely<DB>) {
  return async () => {
    const [members, dependents] = await Promise.all([
      db
        .selectFrom("member")
        .where("deleted_at", "is", null)
        .select(["id", "name", "play_cricket_id", "slug"])
        .orderBy("name", "asc")
        .execute(),
      db
        .selectFrom("dependent")
        .innerJoin("member", "member.id", "dependent.member_id")
        .where("member.deleted_at", "is", null)
        .select([
          "dependent.id",
          "dependent.name",
          "dependent.play_cricket_id",
          "member.name as parentName",
        ])
        .orderBy("dependent.name", "asc")
        .execute(),
    ]);

    return { members, dependents };
  };
}

export function linkPlayCricketPlayer(db: Kysely<DB>) {
  return async (
    type: RecordLinking["type"],
    id: string,
    playCricketId: string,
  ) => {
    const table = type === "member" ? "member" : "dependent";

    await db
      .updateTable(table)
      .set({ play_cricket_id: playCricketId })
      .where("id", "=", id)
      .execute();

    return { success: true };
  };
}

export function unlinkPlayCricketPlayer(db: Kysely<DB>) {
  return async (type: Unlink["type"], id: string) => {
    const table = type === "member" ? "member" : "dependent";

    await db
      .updateTable(table)
      .set({ play_cricket_id: null })
      .where("id", "=", id)
      .execute();

    return { success: true };
  };
}

export function linkSlug(db: Kysely<DB>) {
  return async (memberId: string, slug: string) => {
    await db
      .updateTable("member")
      .set({ slug })
      .where("id", "=", memberId)
      .execute();

    return { success: true };
  };
}

export function unlinkSlug(db: Kysely<DB>) {
  return async (memberId: string) => {
    await db
      .updateTable("member")
      .set({ slug: null })
      .where("id", "=", memberId)
      .execute();

    return { success: true };
  };
}

export function getUserDetail(db: Kysely<DB>) {
  return async (userId: string) => {
    const user = await db
      .selectFrom("user")
      .where("id", "=", userId)
      .select([
        "id",
        "name",
        "email",
        "role",
        "banned",
        "emailVerified",
        "createdAt",
      ])
      .executeTakeFirst();

    if (!user) {
      const error = new Error("User not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    const member = await db
      .selectFrom("member")
      .where("email", "=", user.email)
      .selectAll()
      .executeTakeFirst();

    const membership = member
      ? await db
          .selectFrom("membership")
          .where("member_id", "=", member.id)
          .selectAll()
          .executeTakeFirst()
      : null;

    const dependents = member
      ? await db
          .selectFrom("dependent")
          .where("dependent.member_id", "=", member.id)
          .leftJoin("membership", (join) =>
            join
              .onRef("membership.dependent_id", "=", "dependent.id")
              .onRef("membership.member_id", "=", "dependent.member_id"),
          )
          .select([
            "dependent.id",
            "dependent.name",
            "dependent.dob",
            "dependent.sex",
            "dependent.school_year",
            "dependent.photo_consent",
            "dependent.gp_surgery",
            "dependent.gp_phone",
            "dependent.alt_contact_name",
            "dependent.alt_contact_phone",
            "dependent.emergency_medical_consent",
            "dependent.has_disability",
            "dependent.disability_type",
            "dependent.medical_info",
            "membership.paid_until as membershipPaidUntil",
          ])
          .execute()
      : [];

    const charges = member
      ? await db
          .selectFrom("charge")
          .where("member_id", "=", member.id)
          .selectAll()
          .orderBy("charge_date", "desc")
          .execute()
      : [];

    const juniorManagerTeams = await db
      .selectFrom("junior_team_manager")
      .innerJoin(
        "junior_team",
        "junior_team.id",
        "junior_team_manager.junior_team_id",
      )
      .where("junior_team_manager.user_id", "=", userId)
      .select([
        "junior_team.id",
        "junior_team.name",
        "junior_team.age_group",
        "junior_team.sex",
      ])
      .execute();

    const officialTeams = await db
      .selectFrom("team_official")
      .innerJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "team_official.play_cricket_team_id",
      )
      .where("team_official.user_id", "=", userId)
      .select(["play_cricket_team.id", "play_cricket_team.name"])
      .execute();

    const linkedParents = member
      ? await db
          .selectFrom("member_parent_link")
          .innerJoin(
            "member as parent",
            "parent.id",
            "member_parent_link.parent_member_id",
          )
          .where("member_parent_link.member_id", "=", member.id)
          .select(["parent.id as memberId", "parent.name", "parent.email"])
          .execute()
      : [];

    const linkedJuniors = member
      ? await db
          .selectFrom("member_parent_link")
          .innerJoin(
            "member as junior",
            "junior.id",
            "member_parent_link.member_id",
          )
          .where("member_parent_link.parent_member_id", "=", member.id)
          .select([
            "junior.id as memberId",
            "junior.name",
            "junior.email",
            "junior.dob",
          ])
          .execute()
      : [];

    return {
      user,
      member: member ?? null,
      membership: membership ?? null,
      dependents,
      charges,
      juniorManagerTeams,
      officialTeams,
      linkedParents,
      linkedJuniors,
    };
  };
}

export function searchMembersForParentLink(db: Kysely<DB>) {
  return async (params: SearchMembersForParentLink) => {
    const { juniorMemberId, search } = params;

    const junior = await db
      .selectFrom("member")
      .select(["id", "name"])
      .where("id", "=", juniorMemberId)
      .executeTakeFirst();

    if (!junior) {
      const error = new Error("Member not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    let query = db
      .selectFrom("member")
      .select(["id", "name", "email"])
      .where("id", "<>", juniorMemberId)
      .where("deleted_at", "is", null);

    if (search && search.trim().length > 0) {
      const term = `%${search.trim()}%`;
      query = query.where((eb) =>
        eb.or([eb("name", "ilike", term), eb("email", "ilike", term)]),
      );
    }

    const members = await query.execute();

    const scored = members
      .map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        score: nameSimilarity(junior.name ?? "", m.name ?? ""),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return { juniorName: junior.name, members: scored };
  };
}

export function linkMemberParent(db: Kysely<DB>) {
  return async (params: LinkParent, createdBy: string | null) => {
    const { memberId, parentMemberId } = params;

    if (memberId === parentMemberId) {
      const error = new Error(
        "A member cannot be their own parent",
      ) as Error & { statusCode: number };
      error.statusCode = 400;
      throw error;
    }

    const found = await db
      .selectFrom("member")
      .select("id")
      .where("id", "in", [memberId, parentMemberId])
      .where("deleted_at", "is", null)
      .execute();
    if (found.length !== 2) {
      const error = new Error("Member not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    // Reject the reciprocal case (A↔B). A multi-hop cycle (A→B→C→A)
    // is theoretically possible but unrealistic under admin-managed
    // linking; we keep the cheap single-hop guard for now.
    const reverse = await db
      .selectFrom("member_parent_link")
      .where("member_id", "=", parentMemberId)
      .where("parent_member_id", "=", memberId)
      .select("member_id")
      .executeTakeFirst();
    if (reverse) {
      const error = new Error(
        "Cannot link: the proposed parent is already linked as this member's junior",
      ) as Error & { statusCode: number };
      error.statusCode = 400;
      throw error;
    }

    const existing = await db
      .selectFrom("member_parent_link")
      .where("member_id", "=", memberId)
      .where("parent_member_id", "=", parentMemberId)
      .select("member_id")
      .executeTakeFirst();
    if (existing) {
      return { success: true };
    }

    await db
      .insertInto("member_parent_link")
      .values({
        member_id: memberId,
        parent_member_id: parentMemberId,
        created_by: createdBy,
      })
      .execute();

    return { success: true };
  };
}

export function unlinkMemberParent(db: Kysely<DB>) {
  return async (params: UnlinkParent) => {
    const { memberId, parentMemberId } = params;
    await db
      .deleteFrom("member_parent_link")
      .where("member_id", "=", memberId)
      .where("parent_member_id", "=", parentMemberId)
      .execute();
    return { success: true };
  };
}

export function setMemberCategory(db: Kysely<DB>) {
  return async (userId: string, memberCategory: string | null) => {
    const user = await db
      .selectFrom("user")
      .where("id", "=", userId)
      .select("email")
      .executeTakeFirst();

    if (!user) {
      const error = new Error("User not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    await db
      .updateTable("member")
      .set({ member_category: memberCategory })
      .where("email", "=", user.email)
      .execute();

    return { success: true };
  };
}

export function archiveMember(db: Kysely<DB>) {
  return async (userId: string, reason: string) => {
    const user = await db
      .selectFrom("user")
      .where("id", "=", userId)
      .select("email")
      .executeTakeFirst();

    if (!user) {
      const error = new Error("User not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    const now = new Date().toISOString();

    await Promise.all([
      db
        .updateTable("user")
        .set({ banned: true, banReason: reason })
        .where("id", "=", userId)
        .execute(),
      db
        .updateTable("member")
        .set({
          deleted_at: now,
          deleted_by: userId,
          deleted_reason: reason,
        })
        .where("email", "=", user.email)
        .execute(),
    ]);

    // Close any open financial relief: archived members shouldn't have
    // an active grant generating relieved charges, nor an open request
    // waiting on a committee decision.
    const member = await db
      .selectFrom("member")
      .where("email", "=", user.email)
      .select("id")
      .executeTakeFirst();
    if (member) {
      await closeReliefForArchivedMember(db)(userId, member.id);
    }

    return { success: true };
  };
}

export function restoreMember(db: Kysely<DB>) {
  return async (userId: string) => {
    const user = await db
      .selectFrom("user")
      .where("id", "=", userId)
      .select("email")
      .executeTakeFirst();

    if (!user) {
      const error = new Error("User not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    await Promise.all([
      db
        .updateTable("user")
        .set({ banned: false, banReason: null })
        .where("id", "=", userId)
        .execute(),
      db
        .updateTable("member")
        .set({
          deleted_at: null,
          deleted_by: null,
          deleted_reason: null,
        })
        .where("email", "=", user.email)
        .execute(),
    ]);

    return { success: true };
  };
}

export function createCharge(db: Kysely<DB>) {
  return async (userId: string, adminUserId: string, data: CreateCharge) => {
    const user = await db
      .selectFrom("user")
      .where("id", "=", userId)
      .select("email")
      .executeTakeFirst();

    if (!user) {
      const error = new Error("User not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    const member = await db
      .selectFrom("member")
      .where("email", "=", user.email)
      .select("id")
      .executeTakeFirst();

    if (!member) {
      const error = new Error("No member record found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    const id = crypto.randomUUID();

    await db
      .insertInto("charge")
      .values({
        id,
        member_id: member.id,
        description: data.description,
        amount_pence: data.amountPence,
        charge_date: data.chargeDate,
        created_by: adminUserId,
        source: "admin",
        type: "manual",
      })
      .execute();

    return { id };
  };
}

export function deleteCharge(db: Kysely<DB>) {
  return async (chargeId: string, adminUserId: string, reason: string) => {
    const now = new Date().toISOString();

    const result = await db
      .updateTable("charge")
      .set({
        deleted_at: now,
        deleted_by: adminUserId,
        deleted_reason: reason,
      })
      .where("id", "=", chargeId)
      .where("paid_at", "is", null)
      .where("payment_confirmed_at", "is", null)
      // Relieved charges have a live grant audit. Close the grant first
      // if you really need to soft-delete one.
      .where("relieved_at", "is", null)
      .executeTakeFirst();

    if (result.numUpdatedRows === 0n) {
      const error = new Error("Charge not found or already paid") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    return { success: true };
  };
}

export function getAllJuniorTeams(db: Kysely<DB>) {
  return async () => {
    return await db
      .selectFrom("junior_team")
      .selectAll()
      .orderBy("sex", "asc")
      .orderBy("age_group", "asc")
      .execute();
  };
}

export function getAllPlayCricketTeams(db: Kysely<DB>) {
  return async () => {
    return await db
      .selectFrom("play_cricket_team")
      .selectAll()
      .orderBy("name", "asc")
      .execute();
  };
}

export function listJuniors(db: Kysely<DB>) {
  return async (params: ListJuniors) => {
    const { page, pageSize, search, sex, ageGroup, membershipStatus } = params;

    let query = db
      .selectFrom("dependent")
      .innerJoin("member", "member.id", "dependent.member_id")
      .leftJoin("membership", (join) =>
        join
          .onRef("membership.dependent_id", "=", "dependent.id")
          .on("membership.type", "=", "junior"),
      )
      .leftJoin("user", "user.id", "dependent.user_id")
      .where("member.deleted_at", "is", null);

    if (sex !== "all") {
      query = query.where("dependent.sex", "=", sex);
    }

    if (search && search.trim().length > 0) {
      const term = `%${search.trim()}%`;
      query = query.where((eb) =>
        eb.or([
          eb("dependent.name", "ilike", term),
          eb("member.name", "ilike", term),
        ]),
      );
    }

    // Age group and membership status are computed values — must post-filter.
    // The membership join can produce duplicates if a dependent has multiple
    // membership records. Deduplicate by keeping the latest paid_until per dependent.
    const allRows = await query
      .select([
        "dependent.id",
        "dependent.name",
        "dependent.sex",
        "dependent.dob",
        "dependent.created_at as registeredAt",
        "member.name as parentName",
        "member.email as parentEmail",
        "member.telephone as parentTelephone",
        "membership.paid_until as paidUntil",
        "dependent.user_id as linkedUserId",
        "user.email as linkedUserEmail",
      ])
      .orderBy("dependent.name", "asc")
      .execute();

    // Deduplicate: keep the row with the latest paid_until per dependent
    const deduped = new Map<string, (typeof allRows)[number]>();
    for (const row of allRows) {
      const existing = deduped.get(row.id);
      if (
        !existing ||
        (row.paidUntil &&
          (!existing.paidUntil || row.paidUntil > existing.paidUntil))
      ) {
        deduped.set(row.id, row);
      }
    }

    const now = new Date();
    const filtered = [...deduped.values()].filter((row) => {
      if (ageGroup !== "all" && getAgeGroup(row.dob) !== ageGroup) {
        return false;
      }
      if (
        membershipStatus === "paid" &&
        !(row.paidUntil && new Date(row.paidUntil) >= now)
      ) {
        return false;
      }
      if (
        membershipStatus === "unpaid" &&
        row.paidUntil &&
        new Date(row.paidUntil) >= now
      ) {
        return false;
      }
      return true;
    });

    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const paged = filtered.slice(offset, offset + pageSize);

    return {
      juniors: paged.map((row) => ({
        id: row.id,
        name: row.name,
        sex: row.sex,
        dob: row.dob,
        registeredAt: row.registeredAt,
        parentName: row.parentName,
        parentEmail: row.parentEmail,
        parentTelephone: row.parentTelephone,
        paidUntil: row.paidUntil,
        ageGroup: getAgeGroup(row.dob),
        teamName: getTeamName(row.dob, row.sex),
        hasOwnAccount: row.linkedUserId != null,
        linkedUserEmail: row.linkedUserEmail ?? null,
      })),
      total,
      page,
      pageSize,
    };
  };
}

export function searchUsersForLinking(db: Kysely<DB>) {
  return async (params: SearchUsersForLinking) => {
    const { dependentId, search } = params;

    const dep = await db
      .selectFrom("dependent")
      .select("name")
      .where("id", "=", dependentId)
      .executeTakeFirst();

    if (!dep) {
      const error = new Error("Dependent not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    let query = db.selectFrom("user").select(["id", "name", "email"]);

    if (search && search.trim().length > 0) {
      const term = `%${search.trim()}%`;
      query = query.where((eb) =>
        eb.or([eb("name", "ilike", term), eb("email", "ilike", term)]),
      );
    }

    // Score all matching users to avoid missing valid matches.
    // For a community club (~hundreds of users) this is fine.
    const users = await query.orderBy("name", "asc").execute();

    const scored = users
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        score: nameSimilarity(dep.name, u.name),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return { dependentName: dep.name, users: scored };
  };
}

export function linkDependentToUser(db: Kysely<DB>) {
  return async (params: LinkDependent) => {
    const { dependentId, userId } = params;

    const dep = await db
      .selectFrom("dependent")
      .select(["id", "user_id"])
      .where("id", "=", dependentId)
      .executeTakeFirst();

    if (!dep) {
      const error = new Error("Dependent not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    if (dep.user_id != null) {
      const error = new Error(
        "Dependent is already linked to a user. Unlink first.",
      ) as Error & { statusCode: number };
      error.statusCode = 400;
      throw error;
    }

    const user = await db
      .selectFrom("user")
      .select("id")
      .where("id", "=", userId)
      .executeTakeFirst();

    if (!user) {
      const error = new Error("User not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    await db
      .updateTable("dependent")
      .set({ user_id: userId })
      .where("id", "=", dependentId)
      .execute();

    return { success: true };
  };
}

export function unlinkDependentUser(db: Kysely<DB>) {
  return async (params: UnlinkDependent) => {
    const { dependentId } = params;

    const result = await db
      .updateTable("dependent")
      .set({ user_id: null })
      .where("id", "=", dependentId)
      .executeTakeFirst();

    if (result.numUpdatedRows === 0n) {
      const error = new Error("Dependent not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    return { success: true };
  };
}

const ABANDONED_THRESHOLD_HOURS = 1;

function getAbandonedCutoff(): string {
  return new Date(
    Date.now() - ABANDONED_THRESHOLD_HOURS * 60 * 60 * 1000,
  ).toISOString();
}

function getChargeStatus(
  paidAt: string | null,
  paymentConfirmedAt: string | null,
  deletedAt: string | null,
  stripePaymentIntentId: string | null,
  abandonedCutoff: string,
  createdAt: string,
  relievedAt: string | null,
): "paid" | "pending" | "unpaid" | "abandoned" | "deleted" | "relieved" {
  if (deletedAt) return "deleted";
  // Relieved is a settled state, but a paid relieved charge means the
  // member paid before the grant landed — report it as paid so refunds
  // can be triaged separately.
  if (paidAt) return "paid";
  if (relievedAt) return "relieved";
  if (paymentConfirmedAt) return "pending";
  if (stripePaymentIntentId && createdAt < abandonedCutoff) return "abandoned";
  return "unpaid";
}

export function listAllCharges(db: Kysely<DB>) {
  return async (params: ListCharges) => {
    const { page, pageSize, status, showDeleted, dateFrom, dateTo, search } =
      params;
    const abandonedCutoff = getAbandonedCutoff();

    function applyFilters(
      baseQuery: ReturnType<typeof db.selectFrom<"charge">>,
    ) {
      let q = baseQuery.innerJoin("member", "member.id", "charge.member_id");

      if (!showDeleted) {
        q = q.where("charge.deleted_at", "is", null);
      }

      if (status === "paid") {
        q = q
          .where("charge.paid_at", "is not", null)
          .where("charge.deleted_at", "is", null);
      } else if (status === "pending") {
        q = q
          .where("charge.payment_confirmed_at", "is not", null)
          .where("charge.paid_at", "is", null)
          .where("charge.deleted_at", "is", null)
          .where("charge.relieved_at", "is", null);
      } else if (status === "unpaid") {
        q = q
          .where("charge.paid_at", "is", null)
          .where("charge.payment_confirmed_at", "is", null)
          .where("charge.deleted_at", "is", null)
          // Relieved charges are not unpaid debt.
          .where("charge.relieved_at", "is", null)
          .where((eb) =>
            eb.or([
              eb("charge.stripe_payment_intent_id", "is", null),
              eb("charge.created_at", ">=", abandonedCutoff),
            ]),
          );
      } else if (status === "abandoned") {
        q = q
          .where("charge.stripe_payment_intent_id", "is not", null)
          .where("charge.paid_at", "is", null)
          .where("charge.payment_confirmed_at", "is", null)
          .where("charge.deleted_at", "is", null)
          .where("charge.relieved_at", "is", null)
          .where("charge.created_at", "<", abandonedCutoff);
      } else if (status === "relieved") {
        q = q
          .where("charge.relieved_at", "is not", null)
          .where("charge.deleted_at", "is", null);
      }

      if (dateFrom) {
        q = q.where("charge.charge_date", ">=", dateFrom);
      }
      if (dateTo) {
        q = q.where("charge.charge_date", "<=", dateTo);
      }

      if (search && search.trim().length > 0) {
        const term = `%${search.trim()}%`;
        q = q.where((eb) =>
          eb.or([
            eb("member.name", "ilike", term),
            eb("member.email", "ilike", term),
            eb("charge.description", "ilike", term),
          ]),
        );
      }

      return q;
    }

    const offset = (page - 1) * pageSize;

    const [countResult, charges] = await Promise.all([
      applyFilters(db.selectFrom("charge"))
        .select((eb) => eb.fn.countAll().as("total"))
        .executeTakeFirstOrThrow(),
      applyFilters(db.selectFrom("charge"))
        .select([
          "charge.id",
          "charge.member_id",
          "charge.description",
          "charge.amount_pence",
          "charge.charge_date",
          "charge.created_at",
          "charge.paid_at",
          "charge.payment_confirmed_at",
          "charge.stripe_payment_intent_id",
          "charge.type",
          "charge.source",
          "charge.deleted_at",
          "charge.deleted_reason",
          "charge.relieved_at",
          "member.name as memberName",
          "member.email as memberEmail",
          "member.member_category as memberCategory",
        ])
        .orderBy("charge.charge_date", "desc")
        .limit(pageSize)
        .offset(offset)
        .execute(),
    ]);

    // Resolve which parent(s) absorb each charge: a single batched
    // lookup against member_parent_link for every member appearing on
    // this page.
    const memberIds = Array.from(new Set(charges.map((c) => c.member_id)));
    const parentLinks =
      memberIds.length > 0
        ? await db
            .selectFrom("member_parent_link")
            .innerJoin(
              "member as parent",
              "parent.id",
              "member_parent_link.parent_member_id",
            )
            .where("member_parent_link.member_id", "in", memberIds)
            .select([
              "member_parent_link.member_id",
              "parent.id as parentMemberId",
              "parent.name as parentName",
              "parent.email as parentEmail",
            ])
            .execute()
        : [];

    const parentsByMember = new Map<
      string,
      Array<{ memberId: string; name: string | null; email: string | null }>
    >();
    for (const link of parentLinks) {
      const arr = parentsByMember.get(link.member_id) ?? [];
      arr.push({
        memberId: link.parentMemberId,
        name: link.parentName,
        email: link.parentEmail,
      });
      parentsByMember.set(link.member_id, arr);
    }

    return {
      charges: charges.map((c) => ({
        id: c.id,
        memberId: c.member_id,
        description: c.description,
        amountPence: c.amount_pence,
        chargeDate: c.charge_date,
        createdAt: c.created_at,
        paidAt: c.paid_at,
        paymentConfirmedAt: c.payment_confirmed_at,
        stripePaymentIntentId: c.stripe_payment_intent_id,
        type: c.type,
        source: c.source,
        deletedAt: c.deleted_at,
        deletedReason: c.deleted_reason,
        memberName: c.memberName,
        memberEmail: c.memberEmail,
        memberCategory: c.memberCategory,
        paidByParents: parentsByMember.get(c.member_id) ?? [],
        relievedAt: c.relieved_at,
        status: getChargeStatus(
          c.paid_at,
          c.payment_confirmed_at,
          c.deleted_at,
          c.stripe_payment_intent_id,
          abandonedCutoff,
          c.created_at,
          c.relieved_at,
        ),
      })),
      total: Number(countResult.total),
      page,
      pageSize,
    };
  };
}

export function getChargeAggregates(db: Kysely<DB>) {
  return async (params: ChargeAggregates) => {
    const { dateFrom, dateTo } = params;
    const abandonedCutoff = getAbandonedCutoff();

    let baseQuery = db
      .selectFrom("charge")
      .innerJoin("member", "member.id", "charge.member_id");

    if (dateFrom) {
      baseQuery = baseQuery.where("charge.charge_date", ">=", dateFrom);
    }
    if (dateTo) {
      baseQuery = baseQuery.where("charge.charge_date", "<=", dateTo);
    }

    const result = await baseQuery
      .select([
        sql<string>`COALESCE(SUM(CASE WHEN charge.deleted_at IS NULL THEN charge.amount_pence ELSE 0 END), 0)`.as(
          "totalCharged",
        ),
        sql<string>`COALESCE(SUM(CASE WHEN charge.paid_at IS NOT NULL THEN charge.amount_pence ELSE 0 END), 0)`.as(
          "totalPaid",
        ),
        sql<string>`COALESCE(SUM(CASE WHEN charge.paid_at IS NULL AND charge.deleted_at IS NULL THEN charge.amount_pence ELSE 0 END), 0)`.as(
          "totalOutstanding",
        ),
        sql<string>`COALESCE(SUM(CASE WHEN charge.stripe_payment_intent_id IS NOT NULL AND charge.paid_at IS NULL AND charge.payment_confirmed_at IS NULL AND charge.deleted_at IS NULL AND charge.created_at < ${abandonedCutoff} THEN charge.amount_pence ELSE 0 END), 0)`.as(
          "totalAbandoned",
        ),
        sql<string>`COALESCE(SUM(CASE WHEN charge.deleted_at IS NOT NULL THEN charge.amount_pence ELSE 0 END), 0)`.as(
          "totalDeleted",
        ),
        sql<string>`COUNT(CASE WHEN charge.paid_at IS NOT NULL THEN 1 END)`.as(
          "countPaid",
        ),
        sql<string>`COUNT(CASE WHEN charge.paid_at IS NULL AND charge.payment_confirmed_at IS NULL AND charge.deleted_at IS NULL AND (charge.stripe_payment_intent_id IS NULL OR charge.created_at >= ${abandonedCutoff}) THEN 1 END)`.as(
          "countUnpaid",
        ),
        sql<string>`COUNT(CASE WHEN charge.payment_confirmed_at IS NOT NULL AND charge.paid_at IS NULL AND charge.deleted_at IS NULL THEN 1 END)`.as(
          "countPending",
        ),
        sql<string>`COUNT(CASE WHEN charge.stripe_payment_intent_id IS NOT NULL AND charge.paid_at IS NULL AND charge.payment_confirmed_at IS NULL AND charge.deleted_at IS NULL AND charge.created_at < ${abandonedCutoff} THEN 1 END)`.as(
          "countAbandoned",
        ),
        sql<string>`COUNT(CASE WHEN charge.deleted_at IS NOT NULL THEN 1 END)`.as(
          "countDeleted",
        ),
      ])
      .executeTakeFirstOrThrow();

    return {
      totalCharged: Number(result.totalCharged),
      totalPaid: Number(result.totalPaid),
      totalOutstanding: Number(result.totalOutstanding),
      totalAbandoned: Number(result.totalAbandoned),
      totalDeleted: Number(result.totalDeleted),
      countPaid: Number(result.countPaid),
      countUnpaid: Number(result.countUnpaid),
      countPending: Number(result.countPending),
      countAbandoned: Number(result.countAbandoned),
      countDeleted: Number(result.countDeleted),
    };
  };
}

export interface UnpaidChargeRow {
  id: string;
  chargeDate: string;
  description: string;
  source: string;
  amountPence: number;
  isAbandoned: boolean;
}

export interface UnpaidChargesMemberGroup {
  memberId: string;
  memberName: string | null;
  memberEmail: string | null;
  memberCategory: string | null;
  paidByParents: Array<{ name: string | null; email: string | null }>;
  totalPence: number;
  charges: UnpaidChargeRow[];
}

export function getUnpaidChargesGroupedByMember(db: Kysely<DB>) {
  return async (): Promise<{
    groups: UnpaidChargesMemberGroup[];
    grandTotalPence: number;
  }> => {
    const abandonedCutoff = getAbandonedCutoff();

    const rows = await db
      .selectFrom("charge")
      .innerJoin("member", "member.id", "charge.member_id")
      .where("charge.paid_at", "is", null)
      .where("charge.payment_confirmed_at", "is", null)
      .where("charge.deleted_at", "is", null)
      .where("charge.relieved_at", "is", null)
      .select([
        "charge.id",
        "charge.member_id",
        "charge.description",
        "charge.amount_pence",
        "charge.charge_date",
        "charge.created_at",
        "charge.source",
        "charge.stripe_payment_intent_id",
        "member.name as memberName",
        "member.email as memberEmail",
        "member.member_category as memberCategory",
      ])
      .orderBy("member.name", "asc")
      .orderBy("charge.charge_date", "asc")
      .execute();

    const memberIds = Array.from(new Set(rows.map((r) => r.member_id)));
    const parentLinks =
      memberIds.length > 0
        ? await db
            .selectFrom("member_parent_link")
            .innerJoin(
              "member as parent",
              "parent.id",
              "member_parent_link.parent_member_id",
            )
            .where("member_parent_link.member_id", "in", memberIds)
            .select([
              "member_parent_link.member_id",
              "parent.name as parentName",
              "parent.email as parentEmail",
            ])
            .execute()
        : [];

    const parentsByMember = new Map<
      string,
      Array<{ name: string | null; email: string | null }>
    >();
    for (const link of parentLinks) {
      const arr = parentsByMember.get(link.member_id) ?? [];
      arr.push({ name: link.parentName, email: link.parentEmail });
      parentsByMember.set(link.member_id, arr);
    }

    const byMember = new Map<string, UnpaidChargesMemberGroup>();
    for (const r of rows) {
      const isAbandoned =
        r.stripe_payment_intent_id !== null && r.created_at < abandonedCutoff;
      const existing = byMember.get(r.member_id);
      const charge: UnpaidChargeRow = {
        id: r.id,
        chargeDate: r.charge_date,
        description: r.description,
        source: r.source,
        amountPence: r.amount_pence,
        isAbandoned,
      };
      if (existing) {
        existing.charges.push(charge);
        existing.totalPence += r.amount_pence;
      } else {
        byMember.set(r.member_id, {
          memberId: r.member_id,
          memberName: r.memberName,
          memberEmail: r.memberEmail,
          memberCategory: r.memberCategory,
          paidByParents: parentsByMember.get(r.member_id) ?? [],
          totalPence: r.amount_pence,
          charges: [charge],
        });
      }
    }

    const groups = Array.from(byMember.values()).sort(
      (a, b) => b.totalPence - a.totalPence,
    );
    const grandTotalPence = groups.reduce((acc, g) => acc + g.totalPence, 0);

    return { groups, grandTotalPence };
  };
}

export function markChargePaid(db: Kysely<DB>) {
  return async (
    chargeId: string,
    data: { paymentMethod: "cash" | "bank_transfer" | "card" },
  ) => {
    const result = await db
      .updateTable("charge")
      .set({
        paid_at: new Date().toISOString(),
        payment_method: data.paymentMethod,
      })
      .where("id", "=", chargeId)
      .where("paid_at", "is", null)
      .where("payment_confirmed_at", "is", null)
      .where("deleted_at", "is", null)
      // A relieved charge isn't unpaid debt; admin must close the grant
      // first if they want to revert.
      .where("relieved_at", "is", null)
      .executeTakeFirst();

    if (result.numUpdatedRows === 0n) {
      const error = new Error(
        "Charge not found or already paid/deleted",
      ) as Error & { statusCode: number };
      error.statusCode = 404;
      throw error;
    }

    return { success: true };
  };
}

export function editCharge(db: Kysely<DB>) {
  return async (
    chargeId: string,
    data: { amountPence: number; description: string },
  ) => {
    const result = await db
      .updateTable("charge")
      .set({
        amount_pence: data.amountPence,
        description: data.description,
      })
      .where("id", "=", chargeId)
      .where("paid_at", "is", null)
      .where("payment_confirmed_at", "is", null)
      .where("deleted_at", "is", null)
      .where("relieved_at", "is", null)
      .executeTakeFirst();

    if (result.numUpdatedRows === 0n) {
      const error = new Error(
        "Charge not found or already paid/deleted",
      ) as Error & { statusCode: number };
      error.statusCode = 404;
      throw error;
    }

    return { success: true };
  };
}

export function chasePayment(db: Kysely<DB>) {
  return async (chargeId: string) => {
    const charge = await db
      .selectFrom("charge")
      .innerJoin("member", "member.id", "charge.member_id")
      .where("charge.id", "=", chargeId)
      .where("charge.paid_at", "is", null)
      .where("charge.payment_confirmed_at", "is", null)
      .where("charge.deleted_at", "is", null)
      .where("charge.relieved_at", "is", null)
      .select([
        "charge.id",
        "charge.description",
        "charge.amount_pence",
        "charge.charge_date",
        "member.name as memberName",
        "member.email as memberEmail",
      ])
      .executeTakeFirst();

    if (!charge) {
      const error = new Error(
        "Charge not found or already paid/deleted",
      ) as Error & { statusCode: number };
      error.statusCode = 404;
      throw error;
    }

    // TODO: Send PaymentReminder email via email service
    // For now, return success — email integration will be wired when packages/email is complete
    return { success: true };
  };
}

const NAME_SIMILARITY_THRESHOLD = 0.7;

export function findDuplicateMembers(db: Kysely<DB>) {
  return async () => {
    const allMembers = await db
      .selectFrom("member")
      .where("deleted_at", "is", null)
      .select(["id", "name", "email", "title", "stripe_customer_id"])
      .execute();

    if (allMembers.length === 0) return { groups: [] };

    const allIds = allMembers.map((m) => m.id);
    const memberById = new Map(allMembers.map((m) => [m.id, m]));

    // Batch-fetch counts — PostgreSQL COUNT returns bigint (string in node-pg)
    const [membershipCounts, dependentCounts, chargeCounts] = await Promise.all(
      [
        db
          .selectFrom("membership")
          .where("member_id", "in", allIds)
          .select(["member_id", sql<string>`COUNT(*)`.as("count")])
          .groupBy("member_id")
          .execute(),
        db
          .selectFrom("dependent")
          .where("member_id", "in", allIds)
          .select(["member_id", sql<string>`COUNT(*)`.as("count")])
          .groupBy("member_id")
          .execute(),
        db
          .selectFrom("charge")
          .where("member_id", "in", allIds)
          .select(["member_id", sql<string>`COUNT(*)`.as("count")])
          .groupBy("member_id")
          .execute(),
      ],
    );

    const mcMap = new Map(
      membershipCounts.map((r) => [r.member_id, Number(r.count)]),
    );
    const dcMap = new Map(
      dependentCounts.map((r) => [r.member_id, Number(r.count)]),
    );
    const ccMap = new Map(
      chargeCounts.map((r) => [r.member_id, Number(r.count)]),
    );

    function toGroupMember(id: string) {
      const m = memberById.get(id);
      if (!m) throw new Error(`Member ${id} not found`);
      return {
        id: m.id,
        name: m.name,
        email: m.email,
        title: m.title,
        stripeCustomerId: m.stripe_customer_id,
        membershipCount: mcMap.get(m.id) ?? 0,
        dependentCount: dcMap.get(m.id) ?? 0,
        chargeCount: ccMap.get(m.id) ?? 0,
      };
    }

    // 1. Email duplicate groups — members without an email (guests) can't
    // collide on email, so skip them.
    const emailBuckets = new Map<string, string[]>();
    for (const m of allMembers) {
      if (!m.email) continue;
      const ids = emailBuckets.get(m.email) ?? [];
      ids.push(m.id);
      emailBuckets.set(m.email, ids);
    }

    const emailLinked = new Set<string>();
    const emailGroups: Array<{
      matchType: "email";
      matchKey: string;
      members: Array<ReturnType<typeof toGroupMember>>;
    }> = [];

    for (const [email, ids] of emailBuckets) {
      if (ids.length < 2) continue;
      emailGroups.push({
        matchType: "email",
        matchKey: email,
        members: ids.map(toGroupMember),
      });
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          emailLinked.add([ids[i], ids[j]].sort().join(":"));
        }
      }
    }

    // 2. Fuzzy name duplicate groups (pre-bucketed by normalised surname)
    const surnameBuckets = new Map<string, typeof allMembers>();
    for (const m of allMembers) {
      if (!m.name) continue;
      const normalized = normalizeName(m.name);
      const tokens = normalized.split(" ");
      const surname = tokens[tokens.length - 1] ?? "";
      if (!surname) continue;
      const bucket = surnameBuckets.get(surname) ?? [];
      bucket.push(m);
      surnameBuckets.set(surname, bucket);
    }

    // Direct pair matching — each similar pair becomes its own group.
    // This avoids transitive chains (A~B, B~C does not imply A~C)
    // and ensures no valid pair is dropped.
    const namePairKeys = new Set<string>();
    const nameGroups: Array<{
      matchType: "name";
      matchKey: string;
      members: Array<ReturnType<typeof toGroupMember>>;
    }> = [];

    for (const bucket of surnameBuckets.values()) {
      if (bucket.length < 2) continue;
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i];
          const b = bucket[j];
          const pairKey = [a.id, b.id].sort().join(":");
          if (emailLinked.has(pairKey)) continue;
          if (namePairKeys.has(pairKey)) continue;

          const sim = nameSimilarity(a.name ?? "", b.name ?? "");
          if (sim >= NAME_SIMILARITY_THRESHOLD) {
            namePairKeys.add(pairKey);
            nameGroups.push({
              matchType: "name",
              matchKey: a.name ?? "Unknown",
              members: [toGroupMember(a.id), toGroupMember(b.id)],
            });
          }
        }
      }
    }

    // Email groups first (higher confidence), then name groups
    return { groups: [...emailGroups, ...nameGroups] };
  };
}

export function getMergePreview(db: Kysely<DB>) {
  return async (params: MergePreview) => {
    const { keepMemberId, removeMemberId } = params;

    if (keepMemberId === removeMemberId) {
      const error = new Error("Cannot merge a member with itself") as Error & {
        statusCode: number;
      };
      error.statusCode = 400;
      throw error;
    }

    const memberColumns = [
      "id",
      "name",
      "title",
      "email",
      "address",
      "postcode",
      "dob",
      "telephone",
      "stripe_customer_id",
    ] as const;

    const [keepMember, removeMember] = await Promise.all([
      db
        .selectFrom("member")
        .where("id", "=", keepMemberId)
        .select(memberColumns)
        .executeTakeFirst(),
      db
        .selectFrom("member")
        .where("id", "=", removeMemberId)
        .select(memberColumns)
        .executeTakeFirst(),
    ]);

    if (!keepMember || !removeMember) {
      const error = new Error(
        "One or both member records not found",
      ) as Error & { statusCode: number };
      error.statusCode = 404;
      throw error;
    }

    const [keepMemberships, removeMemberships] = await Promise.all([
      db
        .selectFrom("membership")
        .where("member_id", "=", keepMemberId)
        .select(["id", "type", "paid_until"])
        .execute(),
      db
        .selectFrom("membership")
        .where("member_id", "=", removeMemberId)
        .select(["id", "type", "paid_until"])
        .execute(),
    ]);

    const [keepDependents, removeDependents] = await Promise.all([
      db
        .selectFrom("dependent")
        .where("member_id", "=", keepMemberId)
        .select(["id", "name", "dob"])
        .execute(),
      db
        .selectFrom("dependent")
        .where("member_id", "=", removeMemberId)
        .select(["id", "name", "dob"])
        .execute(),
    ]);

    const [keepCharges, removeCharges] = await Promise.all([
      db
        .selectFrom("charge")
        .where("member_id", "=", keepMemberId)
        .select(["id", "description", "amount_pence", "paid_at"])
        .execute(),
      db
        .selectFrom("charge")
        .where("member_id", "=", removeMemberId)
        .select(["id", "description", "amount_pence", "paid_at"])
        .execute(),
    ]);

    return {
      isCrossEmailMerge: keepMember.email !== removeMember.email,
      keep: {
        member: keepMember,
        memberships: keepMemberships,
        dependents: keepDependents,
        charges: keepCharges,
      },
      remove: {
        member: removeMember,
        memberships: removeMemberships,
        dependents: removeDependents,
        charges: removeCharges,
      },
    };
  };
}

export function mergeMembers(db: Kysely<DB>) {
  return async (params: MergeMembers) => {
    const { keepMemberId, removeMemberId } = params;

    if (keepMemberId === removeMemberId) {
      const error = new Error("Cannot merge a member with itself") as Error & {
        statusCode: number;
      };
      error.statusCode = 400;
      throw error;
    }

    await db.transaction().execute(async (trx) => {
      // Fetch inside transaction to avoid TOCTOU race
      const [keepMember, removeMember] = await Promise.all([
        trx
          .selectFrom("member")
          .where("id", "=", keepMemberId)
          .selectAll()
          .executeTakeFirst(),
        trx
          .selectFrom("member")
          .where("id", "=", removeMemberId)
          .selectAll()
          .executeTakeFirst(),
      ]);

      if (!keepMember || !removeMember) {
        const error = new Error(
          "One or both member records not found",
        ) as Error & { statusCode: number };
        error.statusCode = 404;
        throw error;
      }

      // Re-point all foreign keys from removeMember to keepMember
      await trx
        .updateTable("membership")
        .set({ member_id: keepMemberId })
        .where("member_id", "=", removeMemberId)
        .execute();

      await trx
        .updateTable("dependent")
        .set({ member_id: keepMemberId })
        .where("member_id", "=", removeMemberId)
        .execute();

      await trx
        .updateTable("charge")
        .set({ member_id: keepMemberId })
        .where("member_id", "=", removeMemberId)
        .execute();

      await trx
        .updateTable("matchday_player")
        .set({ member_id: keepMemberId })
        .where("member_id", "=", removeMemberId)
        .execute();

      // Preserve stripe_customer_id if keepMember doesn't have one
      if (!keepMember.stripe_customer_id && removeMember.stripe_customer_id) {
        await trx
          .updateTable("member")
          .set({ stripe_customer_id: removeMember.stripe_customer_id })
          .where("id", "=", keepMemberId)
          .execute();
      }

      // Delete the duplicate member record
      await trx.deleteFrom("member").where("id", "=", removeMemberId).execute();
    });

    return { success: true };
  };
}

export function listContactSubmissions(db: Kysely<DB>) {
  return async (params: ListContactSubmissions) => {
    const { page, pageSize, search } = params;
    const offset = (page - 1) * pageSize;

    let baseQuery = db.selectFrom("contact_submission");

    if (search && search.trim().length > 0) {
      const term = `%${search.trim()}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb("contact_submission.name", "ilike", term),
          eb("contact_submission.email", "ilike", term),
        ]),
      );
    }

    const [countResult, submissions] = await Promise.all([
      baseQuery
        .select((eb) => eb.fn.countAll<string>().as("total"))
        .executeTakeFirstOrThrow(),
      baseQuery
        .select([
          "contact_submission.id",
          "contact_submission.name",
          "contact_submission.email",
          "contact_submission.message",
          "contact_submission.page",
          "contact_submission.created_at",
        ])
        .orderBy("contact_submission.created_at", "desc")
        .limit(pageSize)
        .offset(offset)
        .execute(),
    ]);

    const total = Number(countResult.total);

    return {
      submissions: submissions.map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        message: s.message,
        page: s.page,
        createdAt: s.created_at,
      })),
      total,
      page,
      pageSize,
    };
  };
}

// --- Match fee rates ---

export function listMatchFeeRates(db: Kysely<DB>) {
  return async () => {
    const rates = await db
      .selectFrom("match_fee_rate")
      .leftJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "match_fee_rate.play_cricket_team_id",
      )
      .select([
        "match_fee_rate.id",
        "match_fee_rate.play_cricket_team_id",
        "match_fee_rate.competition_type",
        "match_fee_rate.member_category",
        "match_fee_rate.amount_pence",
        "play_cricket_team.name as team_name",
      ])
      .orderBy("match_fee_rate.member_category", "asc")
      .execute();

    return { rates };
  };
}

export function addMatchFeeRate(db: Kysely<DB>) {
  return async (params: AddMatchFeeRate) => {
    const teamId = params.playCricketTeamId ?? null;
    const competitionType = params.competitionType ?? null;

    // Check for duplicate scope before inserting
    let existsQuery = db
      .selectFrom("match_fee_rate")
      .where("member_category", "=", params.memberCategory);

    if (teamId === null) {
      existsQuery = existsQuery.where("play_cricket_team_id", "is", null);
    } else {
      existsQuery = existsQuery.where("play_cricket_team_id", "=", teamId);
    }

    if (competitionType === null) {
      existsQuery = existsQuery.where("competition_type", "is", null);
    } else {
      existsQuery = existsQuery.where("competition_type", "=", competitionType);
    }

    const existing = await existsQuery.select("id").executeTakeFirst();

    if (existing) {
      const error = new Error(
        "A rate already exists for this team, competition type, and member category",
      ) as Error & { statusCode: number };
      error.statusCode = 409;
      throw error;
    }

    const id = crypto.randomUUID();
    await db
      .insertInto("match_fee_rate")
      .values({
        id,
        play_cricket_team_id: teamId,
        competition_type: competitionType,
        member_category: params.memberCategory,
        amount_pence: params.amountPence,
      })
      .execute();

    return { id };
  };
}

export function deleteMatchFeeRate(db: Kysely<DB>) {
  return async (rateId: string) => {
    const result = await db
      .deleteFrom("match_fee_rate")
      .where("id", "=", rateId)
      .executeTakeFirst();

    if (!result.numDeletedRows || result.numDeletedRows === 0n) {
      const error = new Error("Rate not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    return { success: true };
  };
}

/**
 * List users with any non-default role for the Access tab. Anyone whose
 * `role` column is non-null and contains at least one elevated role slug.
 */
export function listAccessUsers(db: Kysely<DB>) {
  return async () => {
    const items = await db
      .selectFrom("user")
      .where("role", "is not", null)
      .where("role", "<>", "")
      .where("role", "<>", "user")
      .select(["id", "name", "email", "role", "emailVerified", "createdAt"])
      .orderBy("createdAt", "desc")
      .execute();

    return {
      items: items.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role ?? "",
        emailVerified: u.emailVerified,
        createdAt: u.createdAt,
      })),
    };
  };
}

/**
 * Free-text search for any user (by name or email) — used by the Access tab
 * "add user" flow to pick someone before assigning roles.
 */
export function searchUsersForAccess(db: Kysely<DB>) {
  return async (params: SearchUsersForAccess) => {
    const pattern = `%${params.search}%`;
    const items = await db
      .selectFrom("user")
      .where((eb) =>
        eb.or([
          eb("user.name", "ilike", pattern),
          eb("user.email", "ilike", pattern),
        ]),
      )
      .select(["id", "name", "email", "role"])
      .orderBy("user.name", "asc")
      .limit(params.limit)
      .execute();

    return { items };
  };
}

/**
 * Atomically update a user's role string and per-team scope assignments in
 * a single DB transaction. Bypasses better-auth's setRole so all three
 * writes (user.role, junior_team_manager, team_official) either commit
 * together or roll back together — the Access tab can't end up in a state
 * where teams are assigned but the matching scoped role isn't, or vice
 * versa.
 */
export function updateAccessAssignments(db: Kysely<DB>) {
  return async (
    userId: string,
    data: UpdateAccessAssignments,
  ): Promise<{ success: boolean }> => {
    // Normalise + validate the role string: parseRoles drops unknown slugs
    // so we re-serialise from the parsed list. Reject if the round-trip
    // changed anything — that means the client sent a malformed string and
    // we shouldn't silently lose roles.
    const parsedRoles = parseRoles(data.role);
    const normalised = serializeRoles(parsedRoles) || "user";
    const submitted =
      data.role
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
        .join(",") || "user";
    if (submitted !== normalised) {
      const error = new Error(
        `Unknown role(s) in submitted role string: ${data.role}`,
      ) as Error & { statusCode: number };
      error.statusCode = 400;
      throw error;
    }

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("user")
        .set({ role: normalised })
        .where("id", "=", userId)
        .execute();

      await trx
        .deleteFrom("junior_team_manager")
        .where("user_id", "=", userId)
        .execute();
      if (data.juniorTeamIds.length > 0) {
        await trx
          .insertInto("junior_team_manager")
          .values(
            data.juniorTeamIds.map((teamId) => ({
              user_id: userId,
              junior_team_id: teamId,
            })),
          )
          .execute();
      }

      await trx
        .deleteFrom("team_official")
        .where("user_id", "=", userId)
        .execute();
      if (data.officialTeamIds.length > 0) {
        await trx
          .insertInto("team_official")
          .values(
            data.officialTeamIds.map((teamId) => ({
              user_id: userId,
              play_cricket_team_id: teamId,
            })),
          )
          .execute();
      }
    });

    return { success: true };
  };
}
