import Stripe from "stripe";

/**
 * Stripe Global Payouts client (EXPENSES.md Phase 2).
 *
 * Global Payouts is on Stripe's preview v2 API, which the pinned stripe@22 SDK
 * does NOT bundle as typed `moneyManagement` resources (only v2.core.accounts +
 * v2.core.eventDestinations ship). So we drive the money-movement endpoints via
 * `stripe.rawRequest` on a DEDICATED client pinned to the preview apiVersion.
 * This isolates the preview surface completely from the live v1 (Basil)
 * payments client used elsewhere - no SDK bump, no risk to existing flows.
 *
 * The exact preview request/response shapes and event names still need
 * verifying against the live preview account when this is wired end to end
 * (EXPENSES.md, Phase 0 residual notes).
 */

export interface OutboundPaymentResult {
  id: string;
  status: string;
}

export interface PayoutsClient {
  /** Create a Global Payouts recipient (Accounts v2). Returns the account id. */
  createRecipient(args: {
    name: string;
    email: string | null;
  }): Promise<string>;
  /**
   * Hosted link the claimant follows to add their bank details directly to
   * Stripe (so we never hold the sort code / account number). Returns the URL.
   */
  createPayoutMethodSetupLink(args: {
    recipientId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<string>;
  /** The recipient's default payout method id, or null if none is set yet. */
  getDefaultPayoutMethodId(recipientId: string): Promise<string | null>;
  /** Move money from our Financial Account to the recipient. */
  createOutboundPayment(args: {
    recipientId: string;
    payoutMethodId: string;
    amountPence: number;
    description: string;
    idempotencyKey: string;
  }): Promise<OutboundPaymentResult>;
  /** Verify + parse a v2 money-management webhook event. */
  parseWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event;
}

interface RawAccount {
  id: string;
}
interface RawAccountLink {
  url: string;
}
interface RawPayoutMethodList {
  data: Array<{ id: string }>;
}
interface RawOutboundPayment {
  id: string;
  status: string;
}

/**
 * Returns a configured client, or null when Global Payouts isn't provisioned
 * (no financial account id / preview version). Callers must treat null as
 * "payouts not configured" and surface a clear error.
 */
export function createPayoutsClient(config: {
  stripeSecretKey: string;
  financialAccountId?: string;
  apiVersion?: string;
  webhookSecret?: string;
}): PayoutsClient | null {
  if (!config.financialAccountId || !config.apiVersion) return null;

  const financialAccountId = config.financialAccountId;
  const webhookSecret = config.webhookSecret;
  const apiVersion = config.apiVersion;
  const stripe = new Stripe(config.stripeSecretKey);

  // The preview Stripe-Version goes on every request (the constructor's
  // apiVersion is a closed literal union, but the per-request option is a
  // plain string). rawRequest returns Promise<any>, which flows to Promise<T>.
  const raw = <T>(
    method: "GET" | "POST",
    path: string,
    params?: Record<string, unknown>,
    options?: { stripeContext?: string; idempotencyKey?: string },
  ): Promise<T> =>
    stripe.rawRequest(method, path, params, { apiVersion, ...options });

  return {
    async createRecipient({ name, email }) {
      const account = await raw<RawAccount>("POST", "/v2/core/accounts", {
        display_name: name,
        contact_email: email ?? undefined,
        identity: { country: "gb", entity_type: "individual" },
        configuration: {
          recipient: {
            capabilities: { bank_accounts: { local: { requested: true } } },
          },
        },
      });
      return account.id;
    },

    async createPayoutMethodSetupLink({ recipientId, returnUrl, refreshUrl }) {
      const link = await raw<RawAccountLink>("POST", "/v2/core/account_links", {
        account: recipientId,
        use_case: {
          type: "account_onboarding",
          account_onboarding: {
            configurations: ["recipient"],
            return_url: returnUrl,
            refresh_url: refreshUrl,
          },
        },
      });
      return link.url;
    },

    async getDefaultPayoutMethodId(recipientId) {
      const list = await raw<RawPayoutMethodList>(
        "GET",
        "/v2/money_management/payout_methods",
        undefined,
        { stripeContext: recipientId },
      );
      return list.data[0]?.id ?? null;
    },

    async createOutboundPayment({
      recipientId,
      payoutMethodId,
      amountPence,
      description,
      idempotencyKey,
    }) {
      const op = await raw<RawOutboundPayment>(
        "POST",
        "/v2/money_management/outbound_payments",
        {
          from: { financial_account: financialAccountId, currency: "gbp" },
          to: { recipient: recipientId, payout_method: payoutMethodId },
          amount: { value: amountPence, currency: "gbp" },
          description,
        },
        { idempotencyKey },
      );
      return { id: op.id, status: op.status };
    },

    parseWebhookEvent(rawBody, signature) {
      if (!webhookSecret) {
        throw new Error("STRIPE_PAYOUTS_WEBHOOK_SECRET is not set");
      }
      // The v2 thin-event signature scheme matches v1, so constructEvent
      // verifies it. The parsed event carries `type` + `related_object`.
      return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    },
  };
}

/**
 * Map a v2 outbound-payment event type to the expense status it implies, or
 * null if the event isn't a terminal outcome we act on. Kept pure + exported
 * so it can be unit-tested without a live Stripe account.
 */
export function mapOutboundPaymentEvent(
  eventType: string,
): "paid" | "payout_failed" | null {
  const t = eventType.toLowerCase();
  if (t.includes("outbound_payment")) {
    if (t.endsWith(".posted") || t.endsWith(".paid")) return "paid";
    if (
      t.endsWith(".failed") ||
      t.endsWith(".returned") ||
      t.endsWith(".canceled")
    ) {
      return "payout_failed";
    }
  }
  return null;
}
