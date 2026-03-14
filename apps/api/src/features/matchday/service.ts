import { client } from "@percy-main/db";
import type { ListMatches, RecordExpense, UpdateExpense } from "./schemas.js";

export async function listMatches(
  userId: string,
  role: string,
  params: ListMatches,
) {
  const { teamId, limit, offset, statusFilter } = params;

  let query = client.selectFrom("matchday").selectAll("matchday");

  // Non-admin officials can only see matches for their assigned teams
  if (role !== "admin") {
    query = query
      .innerJoin("team_official", "team_official.play_cricket_team_id", "matchday.play_cricket_team_id")
      .where("team_official.user_id", "=", userId) as typeof query;
  }

  if (teamId) {
    query = query.where("matchday.play_cricket_team_id", "=", teamId);
  }

  if (statusFilter !== "all") {
    query = query.where("matchday.status", "=", statusFilter);
  }

  const items = await query
    .orderBy("matchday.match_date", "desc")
    .limit(limit)
    .offset(offset)
    .execute();

  return { items };
}

export async function getMatch(
  userId: string,
  role: string,
  matchId: string,
) {
  // Verify access
  if (role !== "admin") {
    const access = await client
      .selectFrom("matchday")
      .innerJoin("team_official", "team_official.play_cricket_team_id", "matchday.play_cricket_team_id")
      .where("matchday.id", "=", matchId)
      .where("team_official.user_id", "=", userId)
      .select("matchday.id")
      .executeTakeFirst();

    if (!access) {
      const error = new Error("Match not found or access denied") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }
  }

  const match = await client
    .selectFrom("matchday")
    .where("id", "=", matchId)
    .selectAll()
    .executeTakeFirst();

  if (!match) {
    const error = new Error("Match not found") as Error & {
      statusCode: number;
    };
    error.statusCode = 404;
    throw error;
  }

  const [players, expenses] = await Promise.all([
    client
      .selectFrom("matchday_player")
      .where("matchday_id", "=", matchId)
      .selectAll()
      .execute(),
    client
      .selectFrom("matchday_expense")
      .where("matchday_id", "=", matchId)
      .selectAll()
      .execute(),
  ]);

  return { match, players, expenses };
}

export async function recordExpense(
  userId: string,
  data: Omit<RecordExpense, "matchId"> & { matchId: string },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await client
    .insertInto("matchday_expense")
    .values({
      id,
      matchday_id: data.matchId,
      expense_type: data.type,
      description: data.description ?? null,
      amount_pence: data.amountPence,
      created_by: userId,
      created_at: now,
    })
    .execute();

  return { expenseId: id };
}

export async function updateExpense(
  userId: string,
  data: UpdateExpense,
) {
  const fieldsToUpdate: Record<string, unknown> = {};
  if (data.type !== undefined) fieldsToUpdate.expense_type = data.type;
  if (data.description !== undefined)
    fieldsToUpdate.description = data.description;
  if (data.amountPence !== undefined)
    fieldsToUpdate.amount_pence = data.amountPence;

  if (Object.keys(fieldsToUpdate).length > 0) {
    await client
      .updateTable("matchday_expense")
      .set(fieldsToUpdate)
      .where("id", "=", data.expenseId)
      .execute();
  }

  return { success: true };
}

export async function deleteExpense(userId: string, expenseId: string) {
  await client
    .deleteFrom("matchday_expense")
    .where("id", "=", expenseId)
    .execute();

  return { success: true };
}
