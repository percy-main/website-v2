/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import { purchaseSchema, subscribeSchema } from "./schemas.ts";
import {
  handleCheckoutCompleted,
  handleInvoicePayment,
  handlePaymentIntentSucceeded,
} from "./webhook-service.ts";

// Mock email + render to avoid side effects in webhook handler tests
vi.mock("@percy-main/email", () => ({
  send: vi.fn().mockResolvedValue(undefined),
  MembershipUpdated: { subject: "Membership Updated", component: vi.fn() },
  SponsorshipConfirmation: {
    subject: "Sponsorship Confirmation",
    component: vi.fn(),
  },
  PlayerSponsorshipConfirmation: {
    subject: "Player Sponsorship Confirmation",
    component: vi.fn(),
  },
}));

vi.mock("react-email", () => ({
  render: vi.fn().mockResolvedValue("<html></html>"),
}));

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn().mockReturnThis(),
  silent: vi.fn(),
  level: "info",
} as any;

// Stripe timestamp for 2026-03-14T12:00:00Z
const EVENT_CREATED = Math.floor(
  new Date("2026-03-14T12:00:00Z").getTime() / 1000,
);

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
});

afterAll(async () => {
  await stopTestContainer(ctx);
});

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe("payments (integration)", () => {
  describe("purchaseSchema validation", () => {
    it("accepts a valid purchase with priceId only", () => {
      const result = purchaseSchema.safeParse({ priceId: "price_abc123" });
      expect(result.success).toBe(true);
    });

    it("accepts a purchase with optional fields", () => {
      const result = purchaseSchema.safeParse({
        priceId: "price_abc123",
        quantity: 2,
        customAmountPence: 5000,
        metadata: { orderId: "ord-1" },
        email: "buyer@example.com",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing priceId", () => {
      const result = purchaseSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects invalid email", () => {
      const result = purchaseSchema.safeParse({
        priceId: "price_abc123",
        email: "not-an-email",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-positive quantity", () => {
      const result = purchaseSchema.safeParse({
        priceId: "price_abc123",
        quantity: 0,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer customAmountPence", () => {
      const result = purchaseSchema.safeParse({
        priceId: "price_abc123",
        customAmountPence: 49.99,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("subscribeSchema validation", () => {
    it("accepts a valid subscription", () => {
      const result = subscribeSchema.safeParse({
        priceId: "price_sub123",
        membership: "senior_player",
        email: "member@example.com",
      });
      expect(result.success).toBe(true);
    });

    it("accepts all valid membership types", () => {
      const types = [
        "social",
        "senior_player",
        "senior_women_player",
        "concessionary",
      ] as const;
      for (const membership of types) {
        const result = subscribeSchema.safeParse({
          priceId: "price_sub123",
          membership,
          email: "member@example.com",
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid membership type", () => {
      const result = subscribeSchema.safeParse({
        priceId: "price_sub123",
        membership: "invalid_type",
        email: "member@example.com",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing email", () => {
      const result = subscribeSchema.safeParse({
        priceId: "price_sub123",
        membership: "social",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing priceId", () => {
      const result = subscribeSchema.safeParse({
        membership: "social",
        email: "member@example.com",
      });
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// handleCheckoutCompleted
// ---------------------------------------------------------------------------

describe("handleCheckoutCompleted", () => {
  it("creates a membership and charge for a membership checkout", async () => {
    const { email, memberId } = await seedTestUser(ctx.db, {
      email: `checkout-member-${randomUUID()}@test.com`,
    });

    const paymentIntentId = `pi_${randomUUID()}`;
    const sessionId = `cs_${randomUUID()}`;

    const mockStripe = {
      checkout: {
        sessions: {
          retrieve: vi.fn().mockResolvedValue({
            id: sessionId,
            payment_status: "paid",
            payment_intent: paymentIntentId,
            customer_details: { email },
            amount_total: 5000,
            metadata: { type: "membership", membership: "senior_player" },
            line_items: {
              data: [{ price: { type: "one_time", recurring: null } }],
            },
          }),
        },
      },
    } as any;

    const handler = handleCheckoutCompleted({
      db: ctx.db,
      stripe: mockStripe,
      log: mockLog,
      baseUrl: "http://localhost:5173",
      send: vi.fn(),
    });

    await handler({ id: sessionId } as any, EVENT_CREATED);

    const membership = await ctx.db
      .selectFrom("membership")
      .where("member_id", "=", memberId ?? "")
      .where("type", "=", "senior_player")
      .selectAll()
      .executeTakeFirst();

    expect(membership).toBeDefined();
    expect(membership?.paid_until).toBeDefined();

    const charge = await ctx.db
      .selectFrom("charge")
      .where("member_id", "=", memberId ?? "")
      .where("stripe_payment_intent_id", "=", paymentIntentId)
      .selectAll()
      .executeTakeFirst();

    expect(charge).toBeDefined();
    expect(charge?.amount_pence).toBe(5000);
    expect(charge?.type).toBe("membership");
    expect(charge?.source).toBe("webhook");
  });

  it("creates a charge for a game sponsorship checkout", async () => {
    const { email, memberId } = await seedTestUser(ctx.db, {
      email: `sponsor-checkout-${randomUUID()}@test.com`,
    });

    const paymentIntentId = `pi_${randomUUID()}`;
    const sessionId = `cs_${randomUUID()}`;

    const mockStripe = {
      checkout: {
        sessions: {
          retrieve: vi.fn().mockResolvedValue({
            id: sessionId,
            payment_status: "paid",
            payment_intent: paymentIntentId,
            customer_details: { email },
            amount_total: 10000,
            metadata: { type: "sponsorGame", gameId: "game_123" },
            line_items: { data: [] },
          }),
        },
      },
    } as any;

    const handler = handleCheckoutCompleted({
      db: ctx.db,
      stripe: mockStripe,
      log: mockLog,
      baseUrl: "http://localhost:5173",
      send: vi.fn(),
    });

    await handler({ id: sessionId } as any, EVENT_CREATED);

    const charge = await ctx.db
      .selectFrom("charge")
      .where("member_id", "=", memberId ?? "")
      .where("stripe_payment_intent_id", "=", paymentIntentId)
      .selectAll()
      .executeTakeFirst();

    expect(charge).toBeDefined();
    expect(charge?.type).toBe("sponsorship");
    expect(charge?.amount_pence).toBe(10000);
  });

  it("skips charge creation for subscription-mode checkouts (no payment_intent)", async () => {
    const { email, memberId } = await seedTestUser(ctx.db, {
      email: `sub-checkout-${randomUUID()}@test.com`,
    });

    const sessionId = `cs_${randomUUID()}`;

    const mockStripe = {
      checkout: {
        sessions: {
          retrieve: vi.fn().mockResolvedValue({
            id: sessionId,
            payment_status: "paid",
            payment_intent: null,
            customer_details: { email },
            amount_total: 5000,
            metadata: { type: "membership", membership: "social" },
            line_items: {
              data: [{ price: { type: "one_time", recurring: null } }],
            },
          }),
        },
      },
    } as any;

    const handler = handleCheckoutCompleted({
      db: ctx.db,
      stripe: mockStripe,
      log: mockLog,
      baseUrl: "http://localhost:5173",
      send: vi.fn(),
    });

    await handler({ id: sessionId } as any, EVENT_CREATED);

    const membership = await ctx.db
      .selectFrom("membership")
      .where("member_id", "=", memberId ?? "")
      .selectAll()
      .executeTakeFirst();
    expect(membership).toBeDefined();

    const charges = await ctx.db
      .selectFrom("charge")
      .where("member_id", "=", memberId ?? "")
      .selectAll()
      .execute();
    expect(charges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// handleInvoicePayment
// ---------------------------------------------------------------------------

describe("handleInvoicePayment", () => {
  it("creates membership and charge for a direct subscription invoice", async () => {
    const { email, memberId } = await seedTestUser(ctx.db, {
      email: `invoice-direct-${randomUUID()}@test.com`,
    });

    const paymentIntentId = `pi_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const invoiceId = `in_${randomUUID()}`;

    const mockStripe = {
      customers: {
        retrieve: vi.fn().mockResolvedValue({
          id: `cus_${randomUUID()}`,
          email,
          deleted: false,
        }),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: subscriptionId,
          metadata: {
            type: "membership",
            membership: "senior_player",
            source: "direct",
          },
          items: {
            data: [
              {
                price: {
                  type: "recurring",
                  recurring: { interval: "month", interval_count: 1 },
                },
              },
            ],
          },
        }),
      },
      invoicePayments: {
        list: vi.fn().mockResolvedValue({
          data: [
            {
              is_default: true,
              payment: { payment_intent: paymentIntentId },
            },
          ],
        }),
      },
    } as any;

    const handler = handleInvoicePayment({
      db: ctx.db,
      stripe: mockStripe,
      log: mockLog,
      baseUrl: "http://localhost:5173",
      send: vi.fn(),
    });

    await handler(
      {
        id: invoiceId,
        customer: `cus_123`,
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: subscriptionId },
        },
        billing_reason: "subscription_create",
        amount_paid: 5000,
      } as any,
      EVENT_CREATED,
    );

    const membership = await ctx.db
      .selectFrom("membership")
      .where("member_id", "=", memberId ?? "")
      .where("type", "=", "senior_player")
      .selectAll()
      .executeTakeFirst();
    expect(membership).toBeDefined();

    const charge = await ctx.db
      .selectFrom("charge")
      .where("member_id", "=", memberId ?? "")
      .where("stripe_payment_intent_id", "=", paymentIntentId)
      .selectAll()
      .executeTakeFirst();
    expect(charge).toBeDefined();
    expect(charge?.description).toContain("Membership payment");
  });

  it("skips initial invoice for checkout-created subscriptions", async () => {
    const { email, memberId } = await seedTestUser(ctx.db, {
      email: `invoice-skip-${randomUUID()}@test.com`,
    });

    const subscriptionId = `sub_${randomUUID()}`;
    const invoiceId = `in_${randomUUID()}`;

    const mockStripe = {
      customers: {
        retrieve: vi.fn().mockResolvedValue({
          id: `cus_${randomUUID()}`,
          email,
          deleted: false,
        }),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: subscriptionId,
          metadata: {
            type: "membership",
            membership: "senior_player",
          },
          items: {
            data: [
              {
                price: {
                  type: "recurring",
                  recurring: { interval: "month", interval_count: 1 },
                },
              },
            ],
          },
        }),
      },
      invoicePayments: {
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
    } as any;

    const handler = handleInvoicePayment({
      db: ctx.db,
      stripe: mockStripe,
      log: mockLog,
      baseUrl: "http://localhost:5173",
      send: vi.fn(),
    });

    await handler(
      {
        id: invoiceId,
        customer: `cus_123`,
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: subscriptionId },
        },
        billing_reason: "subscription_create",
        amount_paid: 5000,
      } as any,
      EVENT_CREATED,
    );

    const membership = await ctx.db
      .selectFrom("membership")
      .where("member_id", "=", memberId ?? "")
      .selectAll()
      .executeTakeFirst();
    expect(membership).toBeUndefined();
  });

  it("handles subscription renewal with correct description", async () => {
    const { email, memberId } = await seedTestUser(ctx.db, {
      email: `invoice-renewal-${randomUUID()}@test.com`,
    });

    const paymentIntentId = `pi_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const invoiceId = `in_${randomUUID()}`;

    const mockStripe = {
      customers: {
        retrieve: vi.fn().mockResolvedValue({
          id: `cus_${randomUUID()}`,
          email,
          deleted: false,
        }),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: subscriptionId,
          metadata: { type: "membership", membership: "social" },
          items: {
            data: [
              {
                price: {
                  type: "recurring",
                  recurring: { interval: "month", interval_count: 1 },
                },
              },
            ],
          },
        }),
      },
      invoicePayments: {
        list: vi.fn().mockResolvedValue({
          data: [
            {
              is_default: true,
              payment: { payment_intent: paymentIntentId },
            },
          ],
        }),
      },
    } as any;

    const handler = handleInvoicePayment({
      db: ctx.db,
      stripe: mockStripe,
      log: mockLog,
      baseUrl: "http://localhost:5173",
      send: vi.fn(),
    });

    await handler(
      {
        id: invoiceId,
        customer: `cus_123`,
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: subscriptionId },
        },
        billing_reason: "subscription_cycle",
        amount_paid: 3000,
      } as any,
      EVENT_CREATED,
    );

    const charge = await ctx.db
      .selectFrom("charge")
      .where("member_id", "=", memberId ?? "")
      .where("stripe_payment_intent_id", "=", paymentIntentId)
      .selectAll()
      .executeTakeFirst();
    expect(charge).toBeDefined();
    expect(charge?.description).toContain("Membership renewal");
  });

  it("reads legacy (pre-Basil) invoice.subscription + payment_intent shape", async () => {
    // Webhook endpoints configured for api_version <= 2025-03-30 deliver
    // invoices with `subscription` and `payment_intent` at the top level,
    // not under `parent.subscription_details`. We must handle both until
    // every endpoint is rotated to Basil+.
    const { email, memberId } = await seedTestUser(ctx.db, {
      email: `invoice-legacy-${randomUUID()}@test.com`,
    });

    const paymentIntentId = `pi_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const invoiceId = `in_${randomUUID()}`;

    const mockStripe = {
      customers: {
        retrieve: vi.fn().mockResolvedValue({
          id: `cus_${randomUUID()}`,
          email,
          deleted: false,
        }),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: subscriptionId,
          metadata: {
            type: "membership",
            membership: "senior_player",
            source: "direct",
          },
          items: {
            data: [
              {
                price: {
                  type: "recurring",
                  recurring: { interval: "month", interval_count: 1 },
                },
              },
            ],
          },
        }),
      },
      // Legacy shape: invoicePayments.list should never be called because
      // payment_intent is read directly off the invoice.
      invoicePayments: {
        list: vi.fn(),
      },
    } as any;

    const handler = handleInvoicePayment({
      db: ctx.db,
      stripe: mockStripe,
      log: mockLog,
      baseUrl: "http://localhost:5173",
      send: vi.fn(),
    });

    await handler(
      {
        id: invoiceId,
        customer: `cus_123`,
        // Pre-Basil top-level fields:
        subscription: subscriptionId,
        payment_intent: paymentIntentId,
        // parent is omitted entirely on legacy payloads
        billing_reason: "subscription_create",
        amount_paid: 5000,
      } as any,
      EVENT_CREATED,
    );

    expect(mockStripe.invoicePayments.list).not.toHaveBeenCalled();

    const charge = await ctx.db
      .selectFrom("charge")
      .where("member_id", "=", memberId ?? "")
      .where("stripe_payment_intent_id", "=", paymentIntentId)
      .selectAll()
      .executeTakeFirst();
    expect(charge).toBeDefined();
    expect(charge?.description).toContain("Membership payment");
  });

  it("throws on missing customer", async () => {
    const mockStripe = {
      customers: { retrieve: vi.fn().mockResolvedValue(null) },
    } as any;

    const handler = handleInvoicePayment({
      db: ctx.db,
      stripe: mockStripe,
      log: mockLog,
      baseUrl: "http://localhost:5173",
      send: vi.fn(),
    });

    await expect(
      handler(
        { customer: "cus_missing", subscription: null } as any,
        EVENT_CREATED,
      ),
    ).rejects.toThrow("Missing customer");
  });

  it("throws on deleted customer", async () => {
    const mockStripe = {
      customers: { retrieve: vi.fn().mockResolvedValue({ deleted: true }) },
    } as any;

    const handler = handleInvoicePayment({
      db: ctx.db,
      stripe: mockStripe,
      log: mockLog,
      baseUrl: "http://localhost:5173",
      send: vi.fn(),
    });

    await expect(
      handler(
        { customer: "cus_deleted", subscription: null } as any,
        EVENT_CREATED,
      ),
    ).rejects.toThrow("Deleted customer");
  });

  it("falls back to DB membership type when subscription metadata is missing", async () => {
    const { email, memberId } = await seedTestUser(ctx.db, {
      email: `invoice-fallback-${randomUUID()}@test.com`,
    });

    await ctx.db
      .insertInto("membership")
      .values({
        id: randomUUID(),
        member_id: memberId ?? "",
        type: "social",
        paid_until: new Date("2026-01-01").toISOString(),
      })
      .execute();

    const paymentIntentId = `pi_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const invoiceId = `in_${randomUUID()}`;

    const mockStripe = {
      customers: {
        retrieve: vi.fn().mockResolvedValue({
          id: `cus_${randomUUID()}`,
          email,
          deleted: false,
        }),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: subscriptionId,
          metadata: {},
          items: {
            data: [
              {
                price: {
                  type: "recurring",
                  recurring: { interval: "month", interval_count: 1 },
                },
              },
            ],
          },
        }),
      },
      invoicePayments: {
        list: vi.fn().mockResolvedValue({
          data: [
            {
              is_default: true,
              payment: { payment_intent: paymentIntentId },
            },
          ],
        }),
      },
    } as any;

    const handler = handleInvoicePayment({
      db: ctx.db,
      stripe: mockStripe,
      log: mockLog,
      baseUrl: "http://localhost:5173",
      send: vi.fn(),
    });

    await handler(
      {
        id: invoiceId,
        customer: `cus_123`,
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: subscriptionId },
        },
        billing_reason: "subscription_cycle",
        amount_paid: 3000,
      } as any,
      EVENT_CREATED,
    );

    const charge = await ctx.db
      .selectFrom("charge")
      .where("member_id", "=", memberId ?? "")
      .where("stripe_payment_intent_id", "=", paymentIntentId)
      .selectAll()
      .executeTakeFirst();
    expect(charge).toBeDefined();
    expect(charge?.description).toContain("social");
  });
});

// ---------------------------------------------------------------------------
// handlePaymentIntentSucceeded
// ---------------------------------------------------------------------------

describe("handlePaymentIntentSucceeded", () => {
  it("marks unpaid charges as paid and creates junior memberships", async () => {
    const { memberId } = await seedTestUser(ctx.db, {
      email: `charges-${randomUUID()}@test.com`,
    });

    const dependentId = `dep_${randomUUID()}`;
    await ctx.db
      .insertInto("dependent")
      .values({
        id: dependentId,
        member_id: memberId ?? "",
        name: "Junior Child",
        sex: "male",
        dob: "2015-06-01",
      })
      .execute();

    const paymentIntentId = `pi_${randomUUID()}`;
    const chargeId = randomUUID();

    await ctx.db
      .insertInto("charge")
      .values({
        id: chargeId,
        member_id: memberId ?? "",
        description: "Junior membership",
        amount_pence: 2500,
        charge_date: "2026-03-14",
        created_by: "system",
        stripe_payment_intent_id: paymentIntentId,
        paid_at: null,
        type: "junior_membership",
        source: "self_service",
      })
      .execute();

    await ctx.db
      .insertInto("charge_dependent")
      .values({ charge_id: chargeId, dependent_id: dependentId })
      .execute();

    const handler = handlePaymentIntentSucceeded({
      db: ctx.db,
      stripe: {} as any,
      log: mockLog,
      baseUrl: "http://localhost:5173",
      send: vi.fn(),
    });

    await handler(
      {
        id: paymentIntentId,
        created: EVENT_CREATED,
        amount: 2500,
        metadata: { type: "charges" },
        receipt_email: null,
      } as any,
      EVENT_CREATED,
    );

    const charge = await ctx.db
      .selectFrom("charge")
      .where("id", "=", chargeId)
      .selectAll()
      .executeTakeFirst();
    expect(charge?.paid_at).not.toBeNull();

    const juniorMembership = await ctx.db
      .selectFrom("membership")
      .where("dependent_id", "=", dependentId)
      .where("type", "=", "junior")
      .selectAll()
      .executeTakeFirst();
    expect(juniorMembership).toBeDefined();
    const paidUntil = new Date(juniorMembership?.paid_until ?? "");
    expect(paidUntil.getMonth()).toBe(11);
    expect(paidUntil.getDate()).toBe(31);
  });

  it("updates game sponsorship record on payment", async () => {
    const { email, memberId } = await seedTestUser(ctx.db, {
      email: `game-sponsor-pi-${randomUUID()}@test.com`,
    });

    const paymentIntentId = `pi_${randomUUID()}`;
    const sponsorshipId = randomUUID();
    const gameId = `game_${randomUUID()}`;

    await ctx.db
      .insertInto("game_sponsorship")
      .values({
        id: sponsorshipId,
        game_id: gameId,
        sponsor_name: "Test Sponsor",
        sponsor_email: email,
        amount_pence: 15000,
        paid_at: null,
        stripe_payment_intent_id: null,
      })
      .execute();

    const handler = handlePaymentIntentSucceeded({
      db: ctx.db,
      stripe: {} as any,
      log: mockLog,
      baseUrl: "http://localhost:5173",
      send: vi.fn(),
    });

    await handler(
      {
        id: paymentIntentId,
        created: EVENT_CREATED,
        amount: 15000,
        metadata: {
          type: "sponsorGame",
          gameId,
          sponsorshipId,
          email,
        },
        receipt_email: null,
      } as any,
      EVENT_CREATED,
    );

    const sponsorship = await ctx.db
      .selectFrom("game_sponsorship")
      .where("id", "=", sponsorshipId)
      .selectAll()
      .executeTakeFirst();
    expect(sponsorship?.paid_at).not.toBeNull();
    expect(sponsorship?.stripe_payment_intent_id).toBe(paymentIntentId);

    const charge = await ctx.db
      .selectFrom("charge")
      .where("member_id", "=", memberId ?? "")
      .where("type", "=", "sponsorship")
      .selectAll()
      .executeTakeFirst();
    expect(charge).toBeDefined();
    expect(charge?.amount_pence).toBe(15000);
  });

  it("updates player sponsorship record on payment", async () => {
    const { email } = await seedTestUser(ctx.db, {
      email: `player-sponsor-pi-${randomUUID()}@test.com`,
    });

    const paymentIntentId = `pi_${randomUUID()}`;
    const sponsorshipId = randomUUID();

    await ctx.db
      .insertInto("player_sponsorship")
      .values({
        id: sponsorshipId,
        slug: "test-player",
        player_name: "Test Player",
        sponsor_name: "Test Sponsor",
        sponsor_email: email,
        amount_pence: 20000,
        season: 2026,
        paid_at: null,
        stripe_payment_intent_id: null,
      })
      .execute();

    const handler = handlePaymentIntentSucceeded({
      db: ctx.db,
      stripe: {} as any,
      log: mockLog,
      baseUrl: "http://localhost:5173",
      send: vi.fn(),
    });

    await handler(
      {
        id: paymentIntentId,
        created: EVENT_CREATED,
        amount: 20000,
        metadata: {
          type: "sponsorPlayer",
          slug: "test-player",
          sponsorshipId,
          email,
        },
        receipt_email: null,
      } as any,
      EVENT_CREATED,
    );

    const sponsorship = await ctx.db
      .selectFrom("player_sponsorship")
      .where("id", "=", sponsorshipId)
      .selectAll()
      .executeTakeFirst();
    expect(sponsorship?.paid_at).not.toBeNull();
    expect(sponsorship?.stripe_payment_intent_id).toBe(paymentIntentId);
  });

  it("creates membership for one-off payment via payment_intent", async () => {
    const { email, memberId } = await seedTestUser(ctx.db, {
      email: `membership-pi-${randomUUID()}@test.com`,
    });

    const paymentIntentId = `pi_${randomUUID()}`;
    const priceId = `price_${randomUUID()}`;

    const mockStripe = {
      prices: {
        retrieve: vi.fn().mockResolvedValue({
          id: priceId,
          type: "one_time",
          recurring: null,
        }),
      },
    } as any;

    const handler = handlePaymentIntentSucceeded({
      db: ctx.db,
      stripe: mockStripe,
      log: mockLog,
      baseUrl: "http://localhost:5173",
      send: vi.fn(),
    });

    await handler(
      {
        id: paymentIntentId,
        created: EVENT_CREATED,
        amount: 5000,
        metadata: {
          type: "membership",
          membership: "social",
          email,
          priceId,
        },
        receipt_email: null,
      } as any,
      EVENT_CREATED,
    );

    const membership = await ctx.db
      .selectFrom("membership")
      .where("member_id", "=", memberId ?? "")
      .where("type", "=", "social")
      .selectAll()
      .executeTakeFirst();
    expect(membership).toBeDefined();

    const charge = await ctx.db
      .selectFrom("charge")
      .where("member_id", "=", memberId ?? "")
      .where("stripe_payment_intent_id", "=", paymentIntentId)
      .selectAll()
      .executeTakeFirst();
    expect(charge).toBeDefined();
    expect(charge?.type).toBe("membership");
  });

  it("skips membership creation when email is missing from metadata", async () => {
    const handler = handlePaymentIntentSucceeded({
      db: ctx.db,
      stripe: {} as any,
      log: mockLog,
      baseUrl: "http://localhost:5173",
      send: vi.fn(),
    });

    await handler(
      {
        id: `pi_${randomUUID()}`,
        created: EVENT_CREATED,
        amount: 5000,
        metadata: {
          type: "membership",
          membership: "social",
          priceId: "price_123",
        },
        receipt_email: null,
      } as any,
      EVENT_CREATED,
    );

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ paymentIntentId: expect.any(String) }),
      expect.stringContaining("missing email"),
    );
  });

  it("deduplicates charges by payment intent ID", async () => {
    const { email, memberId } = await seedTestUser(ctx.db, {
      email: `dedup-${randomUUID()}@test.com`,
    });

    const paymentIntentId = `pi_${randomUUID()}`;
    const priceId = `price_${randomUUID()}`;

    const mockStripe = {
      prices: {
        retrieve: vi.fn().mockResolvedValue({
          id: priceId,
          type: "one_time",
          recurring: null,
        }),
      },
    } as any;

    const handler = handlePaymentIntentSucceeded({
      db: ctx.db,
      stripe: mockStripe,
      log: mockLog,
      baseUrl: "http://localhost:5173",
      send: vi.fn(),
    });

    const pi = {
      id: paymentIntentId,
      created: EVENT_CREATED,
      amount: 5000,
      metadata: {
        type: "membership",
        membership: "social",
        email,
        priceId,
      },
      receipt_email: null,
    } as any;

    await handler(pi, EVENT_CREATED);
    await handler(pi, EVENT_CREATED);

    const charges = await ctx.db
      .selectFrom("charge")
      .where("member_id", "=", memberId ?? "")
      .where("stripe_payment_intent_id", "=", paymentIntentId)
      .where("type", "=", "membership")
      .selectAll()
      .execute();
    expect(charges).toHaveLength(1);
  });
});
