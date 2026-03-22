import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import type Stripe from "stripe";
import type {
  GameSponsorshipManual,
  GameSponsorshipPayment,
  PlayerSponsorshipManual,
  PlayerSponsorshipPayment,
  SponsorshipList,
  SponsorshipUpdate,
} from "./schemas.ts";

async function fetchStripePriceInfo(stripe: Stripe, priceId: string) {
  const price = await stripe.prices.retrieve(priceId, {
    expand: ["product"],
  });

  if (price.unit_amount === null) {
    throw new Error(`Stripe price ${priceId} has no unit_amount`);
  }

  const product = price.product as Stripe.Product;
  return {
    amountPence: price.unit_amount,
    currency: price.currency,
    productName: product.name,
  };
}

export async function getGameSponsorshipPrice(stripe: Stripe, priceId: string) {
  return fetchStripePriceInfo(stripe, priceId);
}

export async function getPlayerSponsorshipPrice(
  stripe: Stripe,
  priceId: string,
) {
  return fetchStripePriceInfo(stripe, priceId);
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
  return async (slug: string) => {
    const currentYear = new Date().getFullYear();

    const sponsor = await db
      .selectFrom("player_sponsorship")
      .where("slug", "=", slug)
      .where("season", "=", currentYear)
      .where("approved", "=", true)
      .where("paid_at", "is not", null)
      .selectAll()
      .executeTakeFirst();

    return sponsor ?? null;
  };
}

export function hasPlayerPendingSponsor(db: Kysely<DB>) {
  return async (slug: string) => {
    const currentYear = new Date().getFullYear();

    const pending = await db
      .selectFrom("player_sponsorship")
      .where("slug", "=", slug)
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
    query = applyGameSponsorshipFilter(query, filter);

    const [items, countResult] = await Promise.all([
      query
        .selectAll()
        .orderBy("created_at", "desc")
        .limit(pageSize)
        .offset(offset)
        .execute(),
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
    query = applyPlayerSponsorshipFilter(query, filter);

    const [items, countResult] = await Promise.all([
      query
        .selectAll()
        .orderBy("created_at", "desc")
        .limit(pageSize)
        .offset(offset)
        .execute(),
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
        slug: data.slug,
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

export function hasGamePendingSponsor(db: Kysely<DB>) {
  return async (gameId: string) => {
    const cutoff = new Date(Date.now() - PENDING_TTL_MS).toISOString();

    const pending = await db
      .selectFrom("game_sponsorship")
      .where("game_id", "=", gameId)
      .where((eb) =>
        eb.or([
          // Paid but awaiting admin approval
          eb.and([eb("paid_at", "is not", null), eb("approved", "=", false)]),
          // Unpaid but still within the 24h TTL window
          eb.and([eb("paid_at", "is", null), eb("created_at", ">", cutoff)]),
        ]),
      )
      .select("id")
      .executeTakeFirst();

    return { hasPending: !!pending };
  };
}

const PENDING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function createGameSponsorshipPayment(
  db: Kysely<DB>,
  stripe: Stripe,
  gameSponsorshipPriceId: string,
) {
  return async (data: GameSponsorshipPayment) => {
    // Validate logo size
    if (data.sponsorLogoDataUrl && data.sponsorLogoDataUrl.length > 150_000) {
      throw Object.assign(new Error("Logo must be under 150KB"), {
        statusCode: 400,
      });
    }

    // Check for existing paid sponsorship (approved or awaiting approval)
    const existingPaid = await db
      .selectFrom("game_sponsorship")
      .where("game_id", "=", data.gameId)
      .where("paid_at", "is not", null)
      .select("id")
      .executeTakeFirst();

    if (existingPaid) {
      throw Object.assign(new Error("This game already has a sponsor"), {
        statusCode: 400,
      });
    }

    // Check for recent pending payment
    const cutoff = new Date(Date.now() - PENDING_TTL_MS).toISOString();
    const pendingRecent = await db
      .selectFrom("game_sponsorship")
      .where("game_id", "=", data.gameId)
      .where("paid_at", "is", null)
      .where("created_at", ">", cutoff)
      .select("id")
      .executeTakeFirst();

    if (pendingRecent) {
      throw Object.assign(
        new Error("A sponsorship payment is already in progress"),
        { statusCode: 400 },
      );
    }

    // Clean up stale unpaid attempts
    const stale = await db
      .selectFrom("game_sponsorship")
      .where("game_id", "=", data.gameId)
      .where("paid_at", "is", null)
      .where("created_at", "<=", cutoff)
      .select(["id", "stripe_payment_intent_id"])
      .execute();

    for (const row of stale) {
      if (row.stripe_payment_intent_id) {
        try {
          await stripe.paymentIntents.cancel(row.stripe_payment_intent_id);
        } catch {
          // Ignore cancellation errors for already-cancelled intents
        }
      }
      await db
        .deleteFrom("game_sponsorship")
        .where("id", "=", row.id)
        .execute();
    }

    // Fetch price from Stripe
    const price = await getGameSponsorshipPrice(stripe, gameSponsorshipPriceId);
    const sponsorshipId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Insert sponsorship record (unpaid)
    await db
      .insertInto("game_sponsorship")
      .values({
        id: sponsorshipId,
        game_id: data.gameId,
        sponsor_name: data.sponsorName,
        sponsor_email: data.sponsorEmail,
        sponsor_website: data.sponsorWebsite ?? null,
        sponsor_logo_url: data.sponsorLogoDataUrl ?? null,
        sponsor_message: data.sponsorMessage ?? null,
        amount_pence: price.amountPence,
        approved: false,
        paid_at: null,
        created_at: now,
      })
      .execute();

    // Create Stripe payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: price.amountPence,
      currency: price.currency,
      metadata: {
        type: "sponsorGame",
        gameId: data.gameId,
        sponsorshipId,
        email: data.sponsorEmail,
      },
    });

    // Update with Stripe PI ID
    await db
      .updateTable("game_sponsorship")
      .set({ stripe_payment_intent_id: paymentIntent.id })
      .where("id", "=", sponsorshipId)
      .execute();

    return {
      clientSecret: paymentIntent.client_secret,
      amount: price.amountPence,
      productName: price.productName,
    };
  };
}

export function createPlayerSponsorshipPayment(
  db: Kysely<DB>,
  stripe: Stripe,
  playerSponsorshipPriceId: string,
) {
  return async (data: PlayerSponsorshipPayment) => {
    const currentYear = new Date().getFullYear();

    // Validate logo size
    if (data.sponsorLogoDataUrl && data.sponsorLogoDataUrl.length > 150_000) {
      throw Object.assign(new Error("Logo must be under 150KB"), {
        statusCode: 400,
      });
    }

    // Check for existing paid sponsorship this season
    const existingPaid = await db
      .selectFrom("player_sponsorship")
      .where("slug", "=", data.slug)
      .where("season", "=", currentYear)
      .where("approved", "=", true)
      .where("paid_at", "is not", null)
      .select("id")
      .executeTakeFirst();

    if (existingPaid) {
      throw Object.assign(
        new Error("This player already has a sponsor for this season"),
        { statusCode: 400 },
      );
    }

    // Check for recent pending payment
    const cutoff = new Date(Date.now() - PENDING_TTL_MS).toISOString();
    const pendingRecent = await db
      .selectFrom("player_sponsorship")
      .where("slug", "=", data.slug)
      .where("season", "=", currentYear)
      .where("paid_at", "is", null)
      .where("created_at", ">", cutoff)
      .select("id")
      .executeTakeFirst();

    if (pendingRecent) {
      throw Object.assign(
        new Error("A sponsorship payment is already in progress"),
        { statusCode: 400 },
      );
    }

    // Clean up stale unpaid attempts
    const stale = await db
      .selectFrom("player_sponsorship")
      .where("slug", "=", data.slug)
      .where("season", "=", currentYear)
      .where("paid_at", "is", null)
      .where("created_at", "<=", cutoff)
      .select(["id", "stripe_payment_intent_id"])
      .execute();

    for (const row of stale) {
      if (row.stripe_payment_intent_id) {
        try {
          await stripe.paymentIntents.cancel(row.stripe_payment_intent_id);
        } catch {
          // Ignore cancellation errors for already-cancelled intents
        }
      }
      await db
        .deleteFrom("player_sponsorship")
        .where("id", "=", row.id)
        .execute();
    }

    // Fetch price from Stripe
    const price = await getPlayerSponsorshipPrice(
      stripe,
      playerSponsorshipPriceId,
    );
    const sponsorshipId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Insert sponsorship record (unpaid)
    await db
      .insertInto("player_sponsorship")
      .values({
        id: sponsorshipId,
        slug: data.slug,
        player_name: data.playerName,
        sponsor_name: data.sponsorName,
        sponsor_email: data.sponsorEmail,
        sponsor_website: data.sponsorWebsite ?? null,
        sponsor_logo_url: data.sponsorLogoDataUrl ?? null,
        sponsor_message: data.sponsorMessage ?? null,
        amount_pence: price.amountPence,
        season: currentYear,
        approved: false,
        paid_at: null,
        created_at: now,
      })
      .execute();

    // Create Stripe payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: price.amountPence,
      currency: price.currency,
      metadata: {
        type: "sponsorPlayer",
        slug: data.slug,
        sponsorshipId,
        email: data.sponsorEmail,
      },
    });

    // Update with Stripe PI ID
    await db
      .updateTable("player_sponsorship")
      .set({ stripe_payment_intent_id: paymentIntent.id })
      .where("id", "=", sponsorshipId)
      .execute();

    return {
      clientSecret: paymentIntent.client_secret,
      amount: price.amountPence,
      productName: price.productName,
    };
  };
}

// --- Private helpers ---

function applyGameSponsorshipFilter<
  T extends { where: (...args: unknown[]) => T },
>(query: T, filter: SponsorshipList["filter"]): T {
  if (filter === "pending_payment") {
    return query.where("paid_at", "is", null);
  }
  if (filter === "pending_approval") {
    return query.where("paid_at", "is not", null).where("approved", "=", false);
  }
  if (filter === "approved") {
    return query.where("paid_at", "is not", null).where("approved", "=", true);
  }
  return query;
}

function applyPlayerSponsorshipFilter<
  T extends { where: (...args: unknown[]) => T },
>(query: T, filter: SponsorshipList["filter"]): T {
  if (filter === "pending_payment") {
    return query.where("paid_at", "is", null);
  }
  if (filter === "pending_approval") {
    return query.where("paid_at", "is not", null).where("approved", "=", false);
  }
  if (filter === "approved") {
    return query.where("paid_at", "is not", null).where("approved", "=", true);
  }
  return query;
}
