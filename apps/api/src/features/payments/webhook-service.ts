import type { CreatePaymentChargeResult, DB } from "@percy-main/db";
import {
  createJuniorMemberships,
  createPaymentCharge,
  updateMembership,
} from "@percy-main/db";
import {
  MembershipUpdated,
  PlayerSponsorshipConfirmation,
  SponsorshipConfirmation,
  type Email,
} from "@percy-main/email";
import {
  gameSponsoredSchema,
  membershipSchema,
  playerSponsoredSchema,
} from "@percy-main/shared";
import { render } from "@react-email/render";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import { createElement } from "react";
import type Stripe from "stripe";
import { emitMarketingEventForMembership } from "../marketing/membership-hook.ts";
import { invoiceLinesToDuration, stripeDate } from "./stripe-utils.ts";

/** Log a warning if a charge was not created due to missing member. */
function logChargeResult(
  result: CreatePaymentChargeResult,
  context: { email: string; type: string },
  log: FastifyBaseLogger,
) {
  if (!result.created && result.reason === "no_member") {
    // Financial reconciliation issue: paid customer, no member row.
    // Bumped from warn to error so this fires the on-call alarm —
    // every dropped charge means a manual reconciliation later.
    log.error(context, "charge_not_created_no_member");
  }
}

interface WebhookDeps {
  db: Kysely<DB>;
  stripe: Stripe;
  log: FastifyBaseLogger;
  baseUrl: string;
  send: (email: Email) => Promise<void>;
}

// ---------------------------------------------------------------------------
// checkout.session.completed / checkout.session.async_payment_succeeded
// ---------------------------------------------------------------------------

export function handleCheckoutCompleted({
  db,
  stripe,
  log,
  baseUrl,
  send,
}: WebhookDeps) {
  const imageBaseUrl = `${baseUrl}/images`;
  const charge = createPaymentCharge(db);
  const membership = updateMembership(db);

  return async (session: Stripe.Checkout.Session, eventCreated: number) => {
    // Retrieve session with line items expanded
    const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["line_items"],
    });

    const paymentIntentId =
      typeof fullSession.payment_intent === "string"
        ? fullSession.payment_intent
        : fullSession.payment_intent?.id;

    const paidAt = stripeDate(eventCreated);

    // --- Game sponsorship ---
    const sponsorMeta = gameSponsoredSchema.safeParse(fullSession.metadata);
    if (fullSession.payment_status === "paid" && sponsorMeta.success) {
      // TODO: Slack notification (skip for now)
      const email = fullSession.customer_details?.email;
      if (email && fullSession.amount_total) {
        const result = await charge({
          memberEmail: email,
          description: "Game sponsorship",
          amountPence: fullSession.amount_total,
          chargeDate: paidAt,
          type: "sponsorship",
          source: "webhook",
          stripePaymentIntentId: paymentIntentId,
        });
        logChargeResult(result, { email, type: "sponsorship" }, log);
      }
      return;
    }

    // --- Membership ---
    const memberMeta = membershipSchema.safeParse(fullSession.metadata);
    if (
      fullSession.payment_status === "paid" &&
      memberMeta.success &&
      fullSession.customer_details?.email &&
      fullSession.line_items
    ) {
      const email = fullSession.customer_details.email;
      const lineItems = fullSession.line_items.data ?? [];

      // Women's player season fee covers until 31 Dec of payment year
      const isWomenSeasonFee =
        memberMeta.data.membership === "senior_women_player" &&
        lineItems.some((li) => li.price?.type === "one_time");
      const paidUntil = isWomenSeasonFee
        ? new Date(Date.UTC(paidAt.getUTCFullYear(), 11, 31, 23, 59, 59))
        : undefined;

      const result = await membership({
        membershipType: memberMeta.data.membership,
        email,
        addedDuration: invoiceLinesToDuration(lineItems),
        paidAt,
        paidUntil,
      });

      // Subscription-mode checkouts have no payment_intent — skip charge here,
      // it will be created by invoice.payment_succeeded with proper dedup.
      if (fullSession.amount_total && paymentIntentId) {
        const chargeResult = await charge({
          memberEmail: email,
          description: `Membership payment - ${memberMeta.data.membership}`,
          amountPence: fullSession.amount_total,
          chargeDate: paidAt,
          type: "membership",
          source: "webhook",
          stripePaymentIntentId: paymentIntentId,
        });
        logChargeResult(chargeResult, { email, type: "membership" }, log);
      }

      await send({
        to: email,
        subject: MembershipUpdated.subject,
        html: await render(
          createElement(MembershipUpdated.component, {
            imageBaseUrl,
            name: result.name ?? null,
            type: result.type ?? undefined,
            paid_until: result.paid_until,
            isNew: result.isNew,
          }),
        ),
      });

      await emitMarketingEventForMembership(db, log, {
        email,
        amountPence: fullSession.amount_total ?? null,
        membershipType: memberMeta.data.membership,
      });

      return;
    }

    log.info(
      { sessionId: session.id },
      "checkout.session.completed: no matching handler for session metadata",
    );
  };
}

// ---------------------------------------------------------------------------
// invoice.payment_succeeded
// ---------------------------------------------------------------------------

/**
 * Resolve membership metadata from a subscription's invoice.
 *
 * For subscription invoices, metadata lives on the subscription object.
 * Falls back to the member's existing membership type from the DB if
 * subscription metadata is missing.
 *
 * Skips initial invoices for checkout-created subscriptions (those are
 * handled by checkout.session.completed).
 */
async function resolveSubscriptionMembershipMetadata(
  db: Kysely<DB>,
  stripe: Stripe,
  invoice: Stripe.Invoice,
  email: string | null,
  log: FastifyBaseLogger,
) {
  if (!invoice.subscription) {
    return undefined;
  }

  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription.id;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  // Skip initial invoices for checkout-created subscriptions
  if (
    invoice.billing_reason === "subscription_create" &&
    subscription.metadata.source !== "direct"
  ) {
    return undefined;
  }

  const parsed = membershipSchema.safeParse(subscription.metadata);
  if (parsed.success) {
    return parsed.data;
  }

  // Fallback: look up member's existing membership type from DB
  if (email) {
    const existing = await db
      .selectFrom("member")
      .innerJoin("membership", "membership.member_id", "member.id")
      .where("member.email", "=", email)
      .where("membership.dependent_id", "is", null)
      .select(["membership.type"])
      .executeTakeFirst();

    if (existing?.type) {
      const fallbackParsed = membershipSchema.safeParse({
        type: "membership",
        membership: existing.type,
      });
      if (fallbackParsed.success) {
        log.info(
          { email, membershipType: existing.type },
          "Resolved membership type from DB fallback",
        );
        return fallbackParsed.data;
      }
    }
  }

  log.warn(
    { subscriptionId },
    "Could not resolve membership metadata for subscription",
  );
  return undefined;
}

export function handleInvoicePayment({
  db,
  stripe,
  log,
  baseUrl,
  send,
}: WebhookDeps) {
  const imageBaseUrl = `${baseUrl}/images`;
  const charge = createPaymentCharge(db);
  const membership = updateMembership(db);

  return async (invoice: Stripe.Invoice, eventCreated: number) => {
    // Resolve customer
    const customer =
      typeof invoice.customer === "string"
        ? await stripe.customers.retrieve(invoice.customer)
        : invoice.customer;

    const customerId =
      typeof invoice.customer === "string"
        ? invoice.customer
        : (invoice.customer?.id ?? "unknown");

    if (customer == null) {
      throw new Error(`Missing customer: ${customerId}`);
    }
    if (customer.deleted) {
      throw new Error(`Deleted customer: ${customerId}`);
    }

    const { email } = customer;
    if (email == null) {
      throw new Error(`Customer missing email: ${customerId}`);
    }

    const meta = await resolveSubscriptionMembershipMetadata(
      db,
      stripe,
      invoice,
      email,
      log,
    );

    if (!meta) {
      return;
    }

    const paidAt = stripeDate(eventCreated);

    const result = await membership({
      membershipType: meta.membership,
      email,
      addedDuration: invoiceLinesToDuration(invoice.lines.data),
      paidAt,
    });

    const isRenewal = invoice.billing_reason === "subscription_cycle";
    const description = isRenewal
      ? `Membership renewal - ${meta.membership}`
      : `Membership payment - ${meta.membership}`;

    const paymentIntentId =
      typeof invoice.payment_intent === "string"
        ? invoice.payment_intent
        : invoice.payment_intent?.id;

    const chargeResult = await charge({
      memberEmail: email,
      description,
      amountPence: invoice.amount_paid,
      chargeDate: paidAt,
      type: "membership",
      source: "webhook",
      stripePaymentIntentId: paymentIntentId,
    });
    logChargeResult(chargeResult, { email, type: "membership" }, log);

    // Send confirmation email for initial subscription payments only
    if (invoice.billing_reason === "subscription_create") {
      await send({
        to: email,
        subject: MembershipUpdated.subject,
        html: await render(
          createElement(MembershipUpdated.component, {
            imageBaseUrl,
            name: result.name ?? null,
            type: result.type ?? undefined,
            paid_until: result.paid_until,
            isNew: result.isNew,
          }),
        ),
      });

      await emitMarketingEventForMembership(db, log, {
        email,
        amountPence: invoice.amount_paid,
        membershipType: meta.membership,
      });
    }
  };
}

// ---------------------------------------------------------------------------
// payment_intent.succeeded
// ---------------------------------------------------------------------------

export function handlePaymentIntentSucceeded({
  db,
  stripe,
  log,
  baseUrl,
  send,
}: WebhookDeps) {
  const imageBaseUrl = `${baseUrl}/images`;
  const charge = createPaymentCharge(db);
  const membership = updateMembership(db);
  const juniorMemberships = createJuniorMemberships(db);

  return async (paymentIntent: Stripe.PaymentIntent, eventCreated: number) => {
    const { metadata } = paymentIntent;

    // --- Charges (self-service junior/dependent payments) ---
    if (metadata.type === "charges") {
      await handleCharges(db, paymentIntent, log);
      return;
    }

    // --- Game sponsorship ---
    const gameMeta = gameSponsoredSchema.safeParse(metadata);
    if (gameMeta.success) {
      await handleSponsorGame(
        db,
        paymentIntent,
        gameMeta.data,
        eventCreated,
        log,
      );
      return;
    }

    // --- Player sponsorship ---
    const playerMeta = playerSponsoredSchema.safeParse(metadata);
    if (playerMeta.success) {
      await handleSponsorPlayer(
        db,
        paymentIntent,
        playerMeta.data,
        eventCreated,
        log,
      );
      return;
    }

    // --- One-off membership ---
    const memberMeta = membershipSchema.safeParse(metadata);
    if (memberMeta.success) {
      const email = metadata.email;
      const priceId = metadata.priceId;

      if (!email) {
        log.error(
          { paymentIntentId: paymentIntent.id },
          "payment_intent.succeeded: membership payment missing email in metadata",
        );
        return;
      }
      if (!priceId) {
        log.error(
          { paymentIntentId: paymentIntent.id },
          "payment_intent.succeeded: membership payment missing priceId in metadata",
        );
        return;
      }

      const price = await stripe.prices.retrieve(priceId);
      const paidAt = stripeDate(eventCreated);

      const addedDuration =
        price.type === "one_time"
          ? { months: 12 }
          : price.recurring
            ? {
                [`${price.recurring.interval}s`]:
                  price.recurring.interval_count,
              }
            : { days: 0 };

      const paidUntil =
        memberMeta.data.membership === "senior_women_player" &&
        price.type === "one_time"
          ? new Date(Date.UTC(paidAt.getUTCFullYear(), 11, 31, 23, 59, 59))
          : undefined;

      const result = await membership({
        membershipType: memberMeta.data.membership,
        email,
        addedDuration,
        paidAt,
        paidUntil,
      });

      const chargeResult = await charge({
        memberEmail: email,
        description: `Membership payment - ${memberMeta.data.membership}`,
        amountPence: paymentIntent.amount,
        chargeDate: paidAt,
        type: "membership",
        source: "webhook",
        stripePaymentIntentId: paymentIntent.id,
      });
      logChargeResult(chargeResult, { email, type: "membership" }, log);

      await send({
        to: email,
        subject: MembershipUpdated.subject,
        html: await render(
          createElement(MembershipUpdated.component, {
            imageBaseUrl,
            name: result.name ?? null,
            type: result.type ?? undefined,
            paid_until: result.paid_until,
            isNew: result.isNew,
          }),
        ),
      });

      await emitMarketingEventForMembership(db, log, {
        email,
        amountPence: paymentIntent.amount,
        membershipType: memberMeta.data.membership,
      });

      return;
    }

    log.info(
      { paymentIntentId: paymentIntent.id, metadataType: metadata.type },
      "payment_intent.succeeded: no matching handler for metadata",
    );
  };

  // --- Sub-handlers ---

  async function handleCharges(
    db: Kysely<DB>,
    paymentIntent: Stripe.PaymentIntent,
    log: FastifyBaseLogger,
  ) {
    const paidAt = stripeDate(paymentIntent.created);

    // A charge can be relieved *while* a payment is in flight. We must
    // not flip `paid_at` on a now-relieved row — the Stripe payment will
    // need to be refunded out-of-band by the treasurer. Filter both at
    // select-time AND in the update predicate so a race can't slip past.
    const charges = await db
      .selectFrom("charge")
      .where("stripe_payment_intent_id", "=", paymentIntent.id)
      .where("paid_at", "is", null)
      .where("relieved_at", "is", null)
      .select(["id", "member_id"])
      .execute();

    if (charges.length === 0) {
      log.error(
        { paymentIntentId: paymentIntent.id },
        "payment_intent.succeeded: no unpaid charges found for payment intent",
      );
      return;
    }

    for (const ch of charges) {
      await db
        .updateTable("charge")
        .set({ paid_at: paidAt.toISOString() })
        .where("id", "=", ch.id)
        .where("paid_at", "is", null)
        .where("relieved_at", "is", null)
        .execute();
    }

    for (const ch of charges) {
      const linkedDependents = await db
        .selectFrom("charge_dependent")
        .where("charge_id", "=", ch.id)
        .select(["dependent_id"])
        .execute();

      if (linkedDependents.length > 0) {
        await juniorMemberships({
          memberId: ch.member_id,
          dependentIds: linkedDependents.map((d) => d.dependent_id),
          paidAt,
        });
      }
    }
  }

  async function handleSponsorGame(
    db: Kysely<DB>,
    paymentIntent: Stripe.PaymentIntent,
    meta: { gameId: string; sponsorshipId?: string },
    eventCreated: number,
    log: FastifyBaseLogger,
  ) {
    const paidAt = stripeDate(eventCreated);
    const email = paymentIntent.metadata.email ?? paymentIntent.receipt_email;

    if (meta.sponsorshipId) {
      await db
        .updateTable("game_sponsorship")
        .set({
          paid_at: paidAt.toISOString(),
          stripe_payment_intent_id: paymentIntent.id,
        })
        .where("id", "=", meta.sponsorshipId)
        .execute();

      const sponsorship = await db
        .selectFrom("game_sponsorship")
        .where("id", "=", meta.sponsorshipId)
        .select(["sponsor_name", "sponsor_email", "sponsor_message", "game_id"])
        .executeTakeFirst();

      if (sponsorship) {
        // TODO: Slack notification (skip for now)

        await send({
          to: sponsorship.sponsor_email,
          subject: SponsorshipConfirmation.subject,
          html: await render(
            createElement(SponsorshipConfirmation.component, {
              imageBaseUrl,
              sponsorName: sponsorship.sponsor_name,
              gameId: sponsorship.game_id,
              message: sponsorship.sponsor_message ?? undefined,
            }),
          ),
        });
      }
    } else {
      // TODO: Slack notification (skip for now)
      log.info(
        { gameId: meta.gameId },
        "Game sponsored (no sponsorship record)",
      );
    }

    if (email) {
      const result = await charge({
        memberEmail: email,
        description: "Game sponsorship",
        amountPence: paymentIntent.amount,
        chargeDate: paidAt,
        type: "sponsorship",
        source: "webhook",
        stripePaymentIntentId: paymentIntent.id,
      });
      logChargeResult(result, { email, type: "sponsorship" }, log);
    } else {
      // Same reason as charge_not_created_no_member: paid sponsor with
      // no email = manual reconciliation needed. Error level fires
      // the alarm.
      log.error(
        { paymentIntentId: paymentIntent.id, gameId: meta.gameId },
        "sponsorship_charge_not_created_no_email",
      );
    }
  }

  async function handleSponsorPlayer(
    db: Kysely<DB>,
    paymentIntent: Stripe.PaymentIntent,
    meta: { slug: string; sponsorshipId: string },
    eventCreated: number,
    log: FastifyBaseLogger,
  ) {
    const paidAt = stripeDate(eventCreated);
    const email = paymentIntent.metadata.email ?? paymentIntent.receipt_email;

    await db
      .updateTable("player_sponsorship")
      .set({
        paid_at: paidAt.toISOString(),
        stripe_payment_intent_id: paymentIntent.id,
      })
      .where("id", "=", meta.sponsorshipId)
      .execute();

    const sponsorship = await db
      .selectFrom("player_sponsorship")
      .where("id", "=", meta.sponsorshipId)
      .select([
        "sponsor_name",
        "sponsor_email",
        "sponsor_message",
        "player_name",
      ])
      .executeTakeFirst();

    if (sponsorship) {
      // TODO: Slack notification (skip for now)

      await send({
        to: sponsorship.sponsor_email,
        subject: PlayerSponsorshipConfirmation.subject,
        html: await render(
          createElement(PlayerSponsorshipConfirmation.component, {
            imageBaseUrl,
            sponsorName: sponsorship.sponsor_name,
            playerName: sponsorship.player_name,
            message: sponsorship.sponsor_message ?? undefined,
          }),
        ),
      });
    }

    if (email) {
      const result = await charge({
        memberEmail: email,
        description: "Player sponsorship",
        amountPence: paymentIntent.amount,
        chargeDate: paidAt,
        type: "sponsorship",
        source: "webhook",
        stripePaymentIntentId: paymentIntent.id,
      });
      logChargeResult(result, { email, type: "sponsorship" }, log);
    } else {
      // Same reason as charge_not_created_no_member.
      log.error(
        {
          paymentIntentId: paymentIntent.id,
          sponsorshipId: meta.sponsorshipId,
        },
        "player_sponsorship_charge_not_created_no_email",
      );
    }
  }
}
