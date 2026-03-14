import { client } from "@percy-main/db";
import type {
  SponsorshipList,
  SponsorshipUpdate,
  GameSponsorshipManual,
  PlayerSponsorshipManual,
} from "./schemas.js";

export function getGameSponsorshipPrice() {
  return {
    amountPence: 5000,
    currency: "gbp",
    productName: "Game Sponsorship",
  };
}

export function getPlayerSponsorshipPrice() {
  return {
    amountPence: 5000,
    currency: "gbp",
    productName: "Player Sponsorship",
  };
}

export async function getGameSponsorByGameId(gameId: string) {
  const sponsor = await client
    .selectFrom("game_sponsorship")
    .where("game_id", "=", gameId)
    .where("approved", "=", true)
    .where("paid_at", "is not", null)
    .selectAll()
    .executeTakeFirst();

  return sponsor ?? null;
}

export async function getPlayerSponsorForPlayer(contentfulEntryId: string) {
  const currentYear = new Date().getFullYear();

  const sponsor = await client
    .selectFrom("player_sponsorship")
    .where("contentful_entry_id", "=", contentfulEntryId)
    .where("season", "=", currentYear)
    .where("approved", "=", true)
    .where("paid_at", "is not", null)
    .selectAll()
    .executeTakeFirst();

  return sponsor ?? null;
}

export async function hasPlayerPendingSponsor(contentfulEntryId: string) {
  const currentYear = new Date().getFullYear();

  const pending = await client
    .selectFrom("player_sponsorship")
    .where("contentful_entry_id", "=", contentfulEntryId)
    .where("season", "=", currentYear)
    .where((eb) =>
      eb.or([eb("paid_at", "is", null), eb("approved", "=", false)]),
    )
    .select("id")
    .executeTakeFirst();

  return { hasPending: !!pending };
}

export async function getAllApprovedPlayerSponsors(season?: number) {
  const targetSeason = season ?? new Date().getFullYear();

  const sponsors = await client
    .selectFrom("player_sponsorship")
    .where("season", "=", targetSeason)
    .where("approved", "=", true)
    .where("paid_at", "is not", null)
    .selectAll()
    .execute();

  return sponsors;
}

function applyGameSponsorshipFilter(
  query: ReturnType<typeof client.selectFrom<"game_sponsorship">>,
  filter: SponsorshipList["filter"],
) {
  if (filter === "pending_payment") {
    return query.where("paid_at", "is", null);
  }
  if (filter === "pending_approval") {
    return query
      .where("paid_at", "is not", null)
      .where("approved", "=", false);
  }
  if (filter === "approved") {
    return query
      .where("paid_at", "is not", null)
      .where("approved", "=", true);
  }
  return query;
}

function applyPlayerSponsorshipFilter(
  query: ReturnType<typeof client.selectFrom<"player_sponsorship">>,
  filter: SponsorshipList["filter"],
) {
  if (filter === "pending_payment") {
    return query.where("paid_at", "is", null);
  }
  if (filter === "pending_approval") {
    return query
      .where("paid_at", "is not", null)
      .where("approved", "=", false);
  }
  if (filter === "approved") {
    return query
      .where("paid_at", "is not", null)
      .where("approved", "=", true);
  }
  return query;
}

export async function listGameSponsorships(
  page: number,
  pageSize: number,
  filter: SponsorshipList["filter"],
) {
  const offset = (page - 1) * pageSize;

  let query = client.selectFrom("game_sponsorship");
  query = applyGameSponsorshipFilter(query, filter) as typeof query;

  const [items, countResult] = await Promise.all([
    query.selectAll().orderBy("created_at", "desc").limit(pageSize).offset(offset).execute(),
    client
      .selectFrom("game_sponsorship")
      .select(client.fn.countAll().as("total"))
      .executeTakeFirst(),
  ]);

  return {
    items,
    total: Number(countResult?.total ?? 0),
    page,
    pageSize,
  };
}

export async function listPlayerSponsorships(
  page: number,
  pageSize: number,
  filter: SponsorshipList["filter"],
) {
  const offset = (page - 1) * pageSize;

  let query = client.selectFrom("player_sponsorship");
  query = applyPlayerSponsorshipFilter(query, filter) as typeof query;

  const [items, countResult] = await Promise.all([
    query.selectAll().orderBy("created_at", "desc").limit(pageSize).offset(offset).execute(),
    client
      .selectFrom("player_sponsorship")
      .select(client.fn.countAll().as("total"))
      .executeTakeFirst(),
  ]);

  return {
    items,
    total: Number(countResult?.total ?? 0),
    page,
    pageSize,
  };
}

export async function approveGameSponsorship(sponsorshipId: string) {
  await client
    .updateTable("game_sponsorship")
    .set({ approved: true })
    .where("id", "=", sponsorshipId)
    .execute();

  return { success: true };
}

export async function approvePlayerSponsorship(sponsorshipId: string) {
  await client
    .updateTable("player_sponsorship")
    .set({ approved: true })
    .where("id", "=", sponsorshipId)
    .execute();

  return { success: true };
}

export async function rejectGameSponsorship(sponsorshipId: string) {
  await client
    .deleteFrom("game_sponsorship")
    .where("id", "=", sponsorshipId)
    .execute();

  return { success: true };
}

export async function rejectPlayerSponsorship(sponsorshipId: string) {
  await client
    .deleteFrom("player_sponsorship")
    .where("id", "=", sponsorshipId)
    .execute();

  return { success: true };
}

export async function createManualGameSponsorship(data: GameSponsorshipManual) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await client
    .insertInto("game_sponsorship")
    .values({
      id,
      game_id: data.gameId,
      sponsor_name: data.sponsorName,
      sponsor_email: data.sponsorEmail,
      sponsor_website: data.sponsorWebsite ?? null,
      sponsor_logo_url: data.sponsorLogoDataUrl ?? null,
      sponsor_message: data.sponsorMessage ?? null,
      amount_pence: data.amountPence,
      display_name: data.displayName ?? null,
      notes: data.notes ?? null,
      approved: true,
      paid_at: now,
      created_at: now,
    })
    .execute();

  return { id };
}

export async function createManualPlayerSponsorship(
  data: PlayerSponsorshipManual,
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const currentYear = new Date().getFullYear();

  await client
    .insertInto("player_sponsorship")
    .values({
      id,
      contentful_entry_id: data.contentfulEntryId,
      player_name: data.playerName,
      sponsor_name: data.sponsorName,
      sponsor_email: data.sponsorEmail,
      sponsor_website: data.sponsorWebsite ?? null,
      sponsor_logo_url: data.sponsorLogoDataUrl ?? null,
      sponsor_message: data.sponsorMessage ?? null,
      amount_pence: data.amountPence,
      display_name: data.displayName ?? null,
      notes: data.notes ?? null,
      season: currentYear,
      approved: true,
      paid_at: now,
      created_at: now,
    })
    .execute();

  return { id };
}

export async function updateGameSponsorship(
  sponsorshipId: string,
  data: Omit<SponsorshipUpdate, "sponsorshipId">,
) {
  const fieldsToUpdate: Record<string, unknown> = {};
  if (data.displayName !== undefined)
    fieldsToUpdate.display_name = data.displayName;
  if (data.notes !== undefined) fieldsToUpdate.notes = data.notes;
  if (data.sponsorLogoDataUrl !== undefined)
    fieldsToUpdate.sponsor_logo_url = data.sponsorLogoDataUrl;

  if (Object.keys(fieldsToUpdate).length > 0) {
    await client
      .updateTable("game_sponsorship")
      .set(fieldsToUpdate)
      .where("id", "=", sponsorshipId)
      .execute();
  }

  return { success: true };
}

export async function updatePlayerSponsorship(
  sponsorshipId: string,
  data: Omit<SponsorshipUpdate, "sponsorshipId">,
) {
  const fieldsToUpdate: Record<string, unknown> = {};
  if (data.displayName !== undefined)
    fieldsToUpdate.display_name = data.displayName;
  if (data.notes !== undefined) fieldsToUpdate.notes = data.notes;
  if (data.sponsorLogoDataUrl !== undefined)
    fieldsToUpdate.sponsor_logo_url = data.sponsorLogoDataUrl;

  if (Object.keys(fieldsToUpdate).length > 0) {
    await client
      .updateTable("player_sponsorship")
      .set(fieldsToUpdate)
      .where("id", "=", sponsorshipId)
      .execute();
  }

  return { success: true };
}
