import type { Kysely } from "kysely";
import type { DB } from "@percy-main/db";
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

export function getGameSponsorByGameId(db: Kysely<DB>) {
  return async (gameId: string) => {
    const sponsor = await db
      .selectFrom("game_sponsorship")
      .where("game_id", "=", gameId)
      .where("approved", "=", true)
      .where("paid_at", "is not", null)
      .selectAll()
      .executeTakeFirst();

    return sponsor ?? null;
  };
}

export function getPlayerSponsorForPlayer(db: Kysely<DB>) {
  return async (contentfulEntryId: string) => {
    const currentYear = new Date().getFullYear();

    const sponsor = await db
      .selectFrom("player_sponsorship")
      .where("contentful_entry_id", "=", contentfulEntryId)
      .where("season", "=", currentYear)
      .where("approved", "=", true)
      .where("paid_at", "is not", null)
      .selectAll()
      .executeTakeFirst();

    return sponsor ?? null;
  };
}

export function hasPlayerPendingSponsor(db: Kysely<DB>) {
  return async (contentfulEntryId: string) => {
    const currentYear = new Date().getFullYear();

    const pending = await db
      .selectFrom("player_sponsorship")
      .where("contentful_entry_id", "=", contentfulEntryId)
      .where("season", "=", currentYear)
      .where((eb) =>
        eb.or([eb("paid_at", "is", null), eb("approved", "=", false)]),
      )
      .select("id")
      .executeTakeFirst();

    return { hasPending: !!pending };
  };
}

export function getAllApprovedPlayerSponsors(db: Kysely<DB>) {
  return async (season?: number) => {
    const targetSeason = season ?? new Date().getFullYear();

    const sponsors = await db
      .selectFrom("player_sponsorship")
      .where("season", "=", targetSeason)
      .where("approved", "=", true)
      .where("paid_at", "is not", null)
      .selectAll()
      .execute();

    return sponsors;
  };
}

export function listGameSponsorships(db: Kysely<DB>) {
  return async (
    page: number,
    pageSize: number,
    filter: SponsorshipList["filter"],
  ) => {
    const offset = (page - 1) * pageSize;

    let query = db.selectFrom("game_sponsorship");
    query = applyGameSponsorshipFilter(query, filter) as typeof query;

    const [items, countResult] = await Promise.all([
      query.selectAll().orderBy("created_at", "desc").limit(pageSize).offset(offset).execute(),
      db
        .selectFrom("game_sponsorship")
        .select(db.fn.countAll().as("total"))
        .executeTakeFirst(),
    ]);

    return {
      items,
      total: Number(countResult?.total ?? 0),
      page,
      pageSize,
    };
  };
}

export function listPlayerSponsorships(db: Kysely<DB>) {
  return async (
    page: number,
    pageSize: number,
    filter: SponsorshipList["filter"],
  ) => {
    const offset = (page - 1) * pageSize;

    let query = db.selectFrom("player_sponsorship");
    query = applyPlayerSponsorshipFilter(query, filter) as typeof query;

    const [items, countResult] = await Promise.all([
      query.selectAll().orderBy("created_at", "desc").limit(pageSize).offset(offset).execute(),
      db
        .selectFrom("player_sponsorship")
        .select(db.fn.countAll().as("total"))
        .executeTakeFirst(),
    ]);

    return {
      items,
      total: Number(countResult?.total ?? 0),
      page,
      pageSize,
    };
  };
}

export function approveGameSponsorship(db: Kysely<DB>) {
  return async (sponsorshipId: string) => {
    await db
      .updateTable("game_sponsorship")
      .set({ approved: true })
      .where("id", "=", sponsorshipId)
      .execute();

    return { success: true };
  };
}

export function approvePlayerSponsorship(db: Kysely<DB>) {
  return async (sponsorshipId: string) => {
    await db
      .updateTable("player_sponsorship")
      .set({ approved: true })
      .where("id", "=", sponsorshipId)
      .execute();

    return { success: true };
  };
}

export function rejectGameSponsorship(db: Kysely<DB>) {
  return async (sponsorshipId: string) => {
    await db
      .deleteFrom("game_sponsorship")
      .where("id", "=", sponsorshipId)
      .execute();

    return { success: true };
  };
}

export function rejectPlayerSponsorship(db: Kysely<DB>) {
  return async (sponsorshipId: string) => {
    await db
      .deleteFrom("player_sponsorship")
      .where("id", "=", sponsorshipId)
      .execute();

    return { success: true };
  };
}

export function createManualGameSponsorship(db: Kysely<DB>) {
  return async (data: GameSponsorshipManual) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await db
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
  };
}

export function createManualPlayerSponsorship(db: Kysely<DB>) {
  return async (data: PlayerSponsorshipManual) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const currentYear = new Date().getFullYear();

    await db
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
  };
}

export function updateGameSponsorship(db: Kysely<DB>) {
  return async (
    sponsorshipId: string,
    data: Omit<SponsorshipUpdate, "sponsorshipId">,
  ) => {
    const fieldsToUpdate: Record<string, unknown> = {};
    if (data.displayName !== undefined)
      fieldsToUpdate.display_name = data.displayName;
    if (data.notes !== undefined) fieldsToUpdate.notes = data.notes;
    if (data.sponsorLogoDataUrl !== undefined)
      fieldsToUpdate.sponsor_logo_url = data.sponsorLogoDataUrl;

    if (Object.keys(fieldsToUpdate).length > 0) {
      await db
        .updateTable("game_sponsorship")
        .set(fieldsToUpdate)
        .where("id", "=", sponsorshipId)
        .execute();
    }

    return { success: true };
  };
}

export function updatePlayerSponsorship(db: Kysely<DB>) {
  return async (
    sponsorshipId: string,
    data: Omit<SponsorshipUpdate, "sponsorshipId">,
  ) => {
    const fieldsToUpdate: Record<string, unknown> = {};
    if (data.displayName !== undefined)
      fieldsToUpdate.display_name = data.displayName;
    if (data.notes !== undefined) fieldsToUpdate.notes = data.notes;
    if (data.sponsorLogoDataUrl !== undefined)
      fieldsToUpdate.sponsor_logo_url = data.sponsorLogoDataUrl;

    if (Object.keys(fieldsToUpdate).length > 0) {
      await db
        .updateTable("player_sponsorship")
        .set(fieldsToUpdate)
        .where("id", "=", sponsorshipId)
        .execute();
    }

    return { success: true };
  };
}

// --- Private helpers ---

function applyGameSponsorshipFilter<T extends { where: (...args: unknown[]) => T }>(
  query: T,
  filter: SponsorshipList["filter"],
): T {
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

function applyPlayerSponsorshipFilter<T extends { where: (...args: unknown[]) => T }>(
  query: T,
  filter: SponsorshipList["filter"],
): T {
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
