# Conversion Tracking — Platform Design

A campaign-agnostic foundation for marketing events, attribution, consent, and conversion forwarding. This document describes the platform. Individual campaigns (e.g. `RECRUIT_CAMPAIGN.md`) describe their own config on top of it.

The design is grounded in the existing Fastify + Kysely + React codebase and uses Google's own tooling (`gtag.js`, Consent Mode v2, Google Ads API) where it does the job better than custom code.

---

## 1. Goals

- Support **many campaigns over time**, not one. Adding a new campaign should be a config change + a conversion action in Google Ads, nothing more.
- Own first-party data (leads, outcomes, attribution) in our own DB.
- Delegate to Google's pipeline (`gtag.js` + Enhanced Conversions + Consent Mode v2) for the parts they do well.
- Keep offline outcomes (admin-marked "attended", "joined") as a first-class flow, because most of the club's real conversions happen days or weeks after the click.
- No impact on Core Web Vitals. No third-party CMP. No heavy CDP.

---

## 2. Non-goals

- A full analytics product. We are not replacing GA4; we are feeding it.
- Per-user behaviour tracking, session replay, heatmaps.
- Cross-domain tracking, remarketing pixels, audience building.
- An admin UI for defining campaigns. Campaigns live in code for v1.

---

## 3. Three-layer architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser                                                             │
│                                                                      │
│   attribution.ts  → writes pm_attrib cookie on first campaign hit    │
│   consent.ts      → Consent Mode v2 banner + pm_consent cookie       │
│   gtag.ts         → defer-loads gtag.js after consent, fires events  │
│   forms           → read attribution, POST to API, fire gtag event   │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Fastify API (our DB owns the truth)                                 │
│                                                                      │
│   POST /api/marketing/leads  (public, Zod)                           │
│   POST /api/admin/leads/:id/outcomes  (admin)                        │
│                                                                      │
│   emitMarketingEvent()  ← shared service, called from:               │
│     - /api/marketing/leads                                           │
│     - /api/contact  (existing)                                       │
│     - Stripe webhook (existing)                                      │
│     - admin outcome routes                                           │
│                                                                      │
│   writes:  lead, marketing_event, marketing_outbox  (one tx)         │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Offline forwarder (Fastify plugin, in-process drain loop)           │
│                                                                      │
│   Reads marketing_outbox WHERE status='pending'                      │
│   Uploads to Google Ads API (ClickConversion) for offline events     │
│   Retries with backoff, marks dead after 6 attempts                  │
└──────────────────────────────────────────────────────────────────────┘
```

Online conversions (user clicks a button in the browser) go via `gtag.js`. Offline conversions (admin marks an outcome later) go via our forwarder. GA4 reporting is inherited from gtag, so we get pageview/engagement data for free without writing a GA4 client.

---

## 4. Database schema

Three new tables. Conventions match the existing codebase: `TEXT` UUID primary keys, `TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP` timestamps, `JSONB` for flexible metadata, indexes named `idx_<table>_<cols>`.

### 4.1 `lead`

Generic — a person who has entered any funnel.

```
lead
  id                    TEXT PK
  email                 TEXT NOT NULL
  name                  TEXT NULL
  phone                 TEXT NULL
  source                TEXT NOT NULL    -- 'contact_form' | 'marketing_lead_form' | 'stripe_checkout' | ...
  first_campaign_id     TEXT NULL        -- campaign key from the registry
  first_segment         TEXT NULL        -- campaign-defined segment, arbitrary string
  attribution           JSONB NULL       -- gclid/utm snapshot at creation time
  consent_ad_user_data  TEXT NOT NULL DEFAULT 'unknown'   -- 'granted' | 'denied' | 'unknown'
  consent_ad_storage    TEXT NOT NULL DEFAULT 'unknown'   -- 'granted' | 'denied' | 'unknown'
  consent_version       TEXT NULL        -- privacy-notice version at time of submission
  consent_recorded_at   TEXT NULL
  status                TEXT NOT NULL DEFAULT 'new'   -- denormalised from events
  member_id             TEXT NULL REFERENCES member(id)
  notes                 TEXT NULL
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  updated_at            TEXT NULL

  idx: (email), (first_campaign_id, created_at), (status, created_at), (member_id)
```

Notes:

- `status` is denormalised for cheap admin list queries. Events are the source of truth — a comment on the column makes that explicit.
- `first_campaign_id` is set once and never changed — it's the acquisition campaign, not the most recent touchpoint.
- One lead per email (soft constraint — app-level lookup before insert; not a unique index, because legitimate duplicates happen e.g. shared family email).
- **Consent columns capture the user's choices at the moment they submitted the form**, frozen in time. These drive what we may send to Google about this specific lead for the life of the record. Admins may not retroactively "grant" consent on behalf of a user.
- `consent_ad_user_data` is **distinct from** `consent_ad_storage` (see [§8](#8-consent-consent-mode-v2)). A user can grant cookie storage but decline having their hashed email sent to Google, and Google Ads API has a separate field for each.

### 4.2 `marketing_event`

Generic — any event, any source.

```
marketing_event
  id                    TEXT PK
  lead_id               TEXT NULL REFERENCES lead(id)
  user_id               TEXT NULL REFERENCES "user"(id)
  type                  TEXT NOT NULL    -- see event catalogue
  campaign_id           TEXT NULL
  segment               TEXT NULL
  ads_conversion_action TEXT NULL        -- Ads conversion action resource name; non-null means "forward to Ads"
  value_pence           INTEGER NULL
  currency              TEXT NULL        -- 'GBP' unless we ever expand
  attribution           JSONB NULL
  payload               JSONB NULL       -- event-specific data
  source                TEXT NOT NULL    -- 'browser' | 'server' | 'admin' | 'webhook'
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  created_by            TEXT NULL REFERENCES "user"(id)

  idx: (type, created_at), (lead_id), (campaign_id, type, created_at),
       (ads_conversion_action, created_at) WHERE ads_conversion_action IS NOT NULL
```

Notes:

- `type` uses GA4 event naming conventions where possible (`generate_lead`, `sign_up`, `begin_checkout`, `purchase`). Our own outcome events use `lead_*` prefix (`lead_contacted`, `lead_attended_session`, `lead_became_member`).
- `ads_conversion_action` is present iff the event should be uploaded as an Ads offline conversion. Resolved from the campaign registry at emit time.
- `payload` stays small. No dumping entire request bodies.

### 4.3 `marketing_outbox`

Delivery queue for offline conversion uploads.

```
marketing_outbox
  id              TEXT PK
  event_id        TEXT NOT NULL REFERENCES marketing_event(id)
  destination     TEXT NOT NULL           -- 'google_ads' | future: 'meta_ads', 'linkedin_ads'
  status          TEXT NOT NULL DEFAULT 'pending'   -- 'pending' | 'succeeded' | 'failed' | 'dead'
  attempts        INTEGER NOT NULL DEFAULT 0
  last_error      TEXT NULL
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  succeeded_at    TEXT NULL
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

  idx: (status, next_attempt_at), (event_id)
```

Notes:

- Only offline conversions produce outbox rows. Online conversions are fired by `gtag.js` in the browser — nothing for us to retry.
- `destination` is an enum to allow future channels without schema change.
- 6 attempts with exponential backoff (1m, 5m, 30m, 2h, 6h, 24h), then `dead`. Retry window well inside Google's 63-day attribution limit.

### 4.4 What we're _not_ adding

- No `campaign` table. Campaigns live in code (see §6). Promote to DB only when a non-dev needs to create them.
- No `conversion_action` table. Mapped from event type + campaign in code.
- No custom consent record table. Consent is a cookie + (later) a field on `lead` if the user submits a form while giving consent.

---

## 5. Event catalogue

High-signal only. Every event must have a clear producer and a clear reason to exist.

| Event type               | Usual source       | Produces Ads conversion? | Notes                                                                                         |
| ------------------------ | ------------------ | ------------------------ | --------------------------------------------------------------------------------------------- |
| `generate_lead`          | browser / form     | Yes (campaign-primary)   | Someone submitted a lead-capture form. Mapped per-campaign to a Google Ads conversion action. |
| `contact_form_submitted` | `/api/contact`     | Usually no               | General enquiry. Reporting only unless a campaign explicitly opts it in.                      |
| `sign_up`                | better-auth hook   | No (by default)          | Account created. GA4 reporting.                                                               |
| `begin_checkout`         | Stripe pre-session | No                       | Checkout session created.                                                                     |
| `purchase`               | Stripe webhook     | Optional, per-campaign   | Membership paid. Secondary Ads signal for campaigns that want it.                             |
| `lead_contacted`         | admin              | No                       | Funnel reporting.                                                                             |
| `lead_attended_session`  | admin              | Yes (offline)            | Real success signal. Uploaded via Ads API.                                                    |
| `lead_became_member`     | admin or webhook   | Yes (offline)            | Final outcome. Uploaded via Ads API.                                                          |

Adding an event type:

1. Add to the `marketingEventType` Zod enum in `packages/shared`.
2. Decide who emits it (route handler, webhook, admin endpoint).
3. Map it in the campaign registry if any campaign should treat it as a conversion.

No DB migration required.

---

## 6. Campaign registry

Campaigns live in `packages/shared/src/marketing/campaigns.ts` as a typed constant. Treated as config, not code:

```ts
export const campaigns = {
  "recruit-2026": {
    displayName: "Recruit 2026",
    segments: [
      "senior_men_cricket",
      "senior_women_softball_cricket",
      "junior_boys_cricket",
      "junior_girls_dynamos_cricket",
    ],
    primaryEvent: "generate_lead",
    conversionActions: {
      generate_lead: {
        senior_men_cricket: "customers/X/conversionActions/1001",
        senior_women_softball_cricket: "customers/X/conversionActions/1002",
        junior_boys_cricket: "customers/X/conversionActions/1003",
        junior_girls_dynamos_cricket: "customers/X/conversionActions/1004",
      },
      lead_attended_session: { _all: "customers/X/conversionActions/1005" },
      lead_became_member: { _all: "customers/X/conversionActions/1006" },
    },
    defaultValue: { amount: 0, currency: "GBP" as const },
  },
  // Future campaigns added here. Naming convention for segments:
  //   {audience}_{gender}_{format?}_{sport}
  // e.g. senior_women_hardball_cricket, senior_men_football.
} as const;
```

### Type-level guard

Add a compile-time check that every configured segment has a resolvable Ads conversion action for the campaign's primary event — catches PR-time typos before they become silent "skipped upload" bugs at runtime:

```ts
type AssertAllSegmentsHavePrimaryAction<C extends keyof typeof campaigns> =
  (typeof campaigns)[C]["segments"][number] extends keyof (typeof campaigns)[C]["conversionActions"][(typeof campaigns)[C]["primaryEvent"]]
    ? true
    : never;

// Fails to compile if any segment in recruit-2026 lacks a generate_lead action.
type _Check = AssertAllSegmentsHavePrimaryAction<"recruit-2026">;
```

Resolution at emit time:

```ts
function resolveAdsAction(campaignId, eventType, segment): string | null {
  const c = campaigns[campaignId];
  const byType = c?.conversionActions[eventType];
  return byType?.[segment] ?? byType?._all ?? null;
}
```

Benefits:

- Adding a new campaign is one file edit + one PR.
- Per-segment bidding is supported without per-segment code branches.
- A campaign can opt in or out of each event independently.

Promote to a DB table when (and only when) non-developers need to create campaigns themselves.

---

## 7. Attribution capture (browser)

### What is captured

On first load of a page whose URL carries a campaign parameter, read:

- `gclid` / `gbraid` / `wbraid`
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`
- `landing_path` (pathname only)
- `referrer` (`document.referrer`)
- `first_seen_at` (ISO timestamp)

### How it is persisted

- First-party cookie `pm_attrib`, 90-day expiry, `SameSite=Lax`, `Secure`.
- JSON payload, hard-capped at 1.5 KB.
- **First-touch wins** — do not overwrite if the cookie already exists. Simpler, more honest for a grants funnel where someone might click a different ad later but the first was what earned credit.

### Consent gate

- If `pm_consent` is not `granted`, `pm_attrib` is **not** written. We only store attribution data once the user has allowed it.
- Forms still submit without attribution if consent was declined — the lead is still captured, it just won't be credited to an Ads click.

### Shape

```ts
type Attribution = {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  landing_path?: string;
  referrer?: string;
  experiment_id?: string; // optional — e.g. "womens-label-test-2026"
  variant?: string; // optional — e.g. "softball-emphasis" or "control"
  first_seen_at: string;
};
```

Lives in `packages/shared/src/marketing/attribution.ts` so server and web agree.

### Experimentation (light-touch)

We do not build a parallel-assignment experiment engine on day 1. The two new optional fields above are enough to make future tests _measurable_:

- **Ad copy tests**: use Google's **Responsive Search Ads** — Google rotates and optimises automatically from the headlines/descriptions supplied per ad group. No code changes, no `experiment_id` needed at our end; the ad copy variance shows up naturally in Ads reports.
- **Landing page / segment label tests**: run **sequentially** (version A for 4 weeks, B for 4 weeks, compare by date range) until traffic justifies parallel testing. Volume is the binding constraint — Grants campaigns at this budget produce tens, not hundreds, of conversions per month per segment.
- **When we do need a variant dimension**: either include it in the landing URL (`?variant=X`) or set it from a short client-side helper. Either way it ends up in `pm_attrib.variant` and then on every `marketing_event.attribution.variant` — queryable in admin and forwardable to GA4 as an event parameter.

Explicitly deferred: parallel random assignment, significance testing, experiment admin UI. Revisit only if traffic grows or we want to test something conversion-critical (e.g. form layout).

---

## 8. Consent (Consent Mode v2)

UK/EEA traffic requires Consent Mode v2 for Google Ads conversions to count correctly. We will ship a home-grown banner — no third-party CMP.

### Pattern chosen: Full Consent Mode v2

Consent Mode v2 supports two shapes:

- **Pattern A — "Full Consent Mode v2"** _(chosen)_: load `gtag.js` on every page regardless of consent; before a decision it sends cookieless modelling pings; on accept it upgrades to full tracking; on decline it continues with denied signals only. Google's recommended pattern, and the one that gives Ads the most information to optimise bidding.
- **Pattern B — "Defer `gtag.js` until consent"**: only inject `gtag.js` after the user clicks Allow. Simpler and script-free for decliners, but loses the cookieless modelling benefit.

We use **Pattern A**: async `gtag.js` load on every page, consent gates what it's allowed to do. Trade-off vs B: every visitor pays for `gtag.js` (~70 KB, async, non-blocking). In return, Ads gets modelled conversions for declined / pre-decision traffic, and behaviour is identical for accept/decline users from the page-weight perspective (no post-consent script load to trigger a reflow or a cache miss).

### Inline stub (every page, synchronous)

Added to `index.html`. ~500 bytes, runs before `gtag.js` so the default denied state is set before any tag fires:

```html
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag() {
    dataLayer.push(arguments);
  }
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
    wait_for_update: 500,
  });
</script>
```

`wait_for_update: 500` tells `gtag.js` to briefly hold conversion pings while the app reads `pm_consent` (see below) and issues an `update` if appropriate — this avoids a flash of denied-then-granted for returning visitors.

### Async `gtag.js` load (every page)

Also in `index.html`, after the stub:

```html
<script
  async
  src="https://www.googletagmanager.com/gtag/js?id=%VITE_GA4_MEASUREMENT_ID%"
></script>
<script>
  gtag("js", new Date());
  gtag("config", "%VITE_GA4_MEASUREMENT_ID%");
  gtag("config", "%VITE_GOOGLE_ADS_CONVERSION_ID%");
</script>
```

The template placeholders are substituted by Vite at build time; if either env var is absent, the tags are omitted (keeps local dev clean).

### Banner UX

- Fixed-position bar at the bottom of the page. Full-width on mobile, stacked content + buttons. Page content gets ~72px of `padding-bottom` until dismissed to avoid covering it.
- Not modal. Not blocking. Not decorative. Keyboard-navigable, screen-reader-labelled.
- If consent is already recorded on page load, banner does not render, and the app issues the appropriate `gtag('consent', 'update', ...)` immediately (within the `wait_for_update` window).

Copy:

> A quick note — we run Google Ads to bring new players to the club, and we use a couple of cookies to see which ones work. You can say no; the site works the same either way.
>
> [Allow] [Decline] [Privacy]

Button styling: "Allow" uses the club's primary green, "Decline" uses a neutral grey. Both buttons are the same size and weight — colour is the only differentiation, no dark-pattern asymmetry.

### Consent record

A single `granted|denied` cookie isn't enough for a defensible audit trail. Store:

```ts
type ConsentRecord = {
  state: "granted" | "denied";
  version: string; // policy version at time of decision, e.g. "2026-05-01"
  timestamp: string; // ISO 8601 UTC
  source: "banner" | "settings-link" | "privacy-page";
};
```

Serialised JSON in a first-party cookie `pm_consent`, 12-month expiry, `SameSite=Lax`, `Secure`. Writing a new record with a later timestamp supersedes the previous one; we do not keep history in the cookie (too heavy). If a written audit trail is ever needed, the same record can be mirrored to a server-side `consent_event` table (deferred; flag if required).

`version` bumps whenever the privacy notice materially changes what data we send to Google. If a visitor's stored `version` is older than the current one, the banner re-appears so they can re-consent (or re-decline) against the new terms.

### Cookie settings / withdrawal

Withdrawal must be as easy as acceptance (PECR + Google EU User Consent Policy). Two entry points:

- Persistent **"Cookie settings"** link in the site footer, visible on every page. Clicking it re-opens the banner so the user can flip their choice either direction.
- Same link embedded in the privacy page, next to the cookies section.

Flipping consent writes a new `ConsentRecord` with `source: "settings-link"` and calls `gtag('consent', 'update', ...)` with the new state. No page reload required.

### On accept

```js
gtag("consent", "update", {
  ad_storage: "granted",
  ad_user_data: "granted",
  ad_personalization: "granted",
  analytics_storage: "granted",
});
```

Write a `ConsentRecord` with `state: "granted"`, current `version`, `timestamp: Date.now()`, `source: "banner"`. From then on, `attribution.ts` is allowed to write `pm_attrib` on the next campaign-parameter hit.

### On decline

`gtag` stays in denied state. Google's cookieless pings continue — modelling signals reach Ads with no user identifiers attached (Consent Mode v2 behaviour). `pm_attrib` is never written. Write a `ConsentRecord` with `state: "denied"`.

### Returning visitors

On subsequent page loads the stub queues default=denied as always. Immediately after the stub, the app reads the stored `ConsentRecord` and:

- If absent, or if `version` is older than the current one → show banner.
- If present and current → issue matching `gtag('consent', 'update', ...)` inside the 500ms `wait_for_update` window, skip the banner.

This keeps the Advanced Consent Mode transition seamless and ensures a privacy-notice change triggers re-consent.

### What the banner does not do

- No per-vendor, per-purpose toggles. Two buttons. Good enough for UK PECR when paired with a clear privacy notice.
- No IAB TCF string, no GPP. Not needed for a nonprofit site using only Google Ads.

---

## 9. Public API surface

One new public endpoint. All others are internal or admin.

### `POST /api/marketing/leads`

Captures a lead from any public form. Replaces the dedicated "trial" endpoint from the first draft — any campaign's form submits here.

```ts
// packages/shared/src/marketing/schemas.ts
const consentStateSchema = z.enum(["granted", "denied", "unknown"]);

const marketingLeadSchema = z.object({
  campaignId: z.string(), // from campaign registry
  segment: z.string().optional(), // campaign-defined
  name: z.string().min(1),
  email: z.email(),
  phone: z.string().optional(),
  source: z.string(), // which form posted this
  fields: z.record(z.string(), z.unknown()).optional(), // free-form campaign-specific
  attribution: attributionSchema.optional(),
  consent: z.object({
    ad_user_data: consentStateSchema, // sending hashed email / gclid to Google
    ad_storage: consentStateSchema, // cookies + attribution storage
    version: z.string(), // privacy-notice version the user consented against
    recordedAt: z.string(), // ISO timestamp from pm_consent
  }),
});
```

Note: consent is required but any of its axes may be `denied` or `unknown`. A submission with `ad_user_data: 'denied'` still creates the lead — we just never send the user's hashed email to Google for that lead. Submitting the form itself is the lawful basis for the club to respond; it is not tied to advertising consent.

The handler:

1. Validates `campaignId` against the registry. Unknown campaign → 400.
2. Upserts `lead` by email (updates existing if present, sets `first_campaign_id` only if null).
3. Emits `generate_lead` via the shared service.
4. Fire-and-forget: Slack notify (existing pattern), SES confirmation email.
5. Returns `{ leadId }`.

Rate-limited and honeypot-protected. No generic `POST /api/marketing/events` — we don't want the public to write arbitrary event types.

### `POST /api/admin/leads/:leadId/outcomes`

Admin-only. Body `{ outcome: 'contacted' | 'attended' | 'joined' | 'lost', notes?, memberId? }`. Emits the corresponding event, updates `lead.status`, enqueues Ads upload for `attended` and `joined`.

### Hooked into existing features

- `apps/api/src/features/contact/service.ts` — on submit, also calls `emitMarketingEvent('contact_form_submitted', ...)` and (if campaign param provided on form) creates a `lead`.
- `apps/api/src/features/payments/webhook-service.ts` — on `checkout.session.completed`, matches by email back to a `lead`, sets `lead.member_id`, emits `purchase` and (if campaign opted in) `lead_became_member`.

---

## 10. Online conversions (gtag.js)

### Loading

- Per [§8](#8-consent-consent-mode-v2) (Pattern A): the inline `gtag()`/`dataLayer` stub and async `gtag.js` are both in `index.html` and run on every page. Consent gates what the tag is allowed to do, not whether it loads.
- `gtag.js` is ~70 KB, `async`, non-render-blocking. Measured CWV impact is negligible.
- Measurement ID and Ads conversion ID come from Vite env vars (`VITE_GA4_MEASUREMENT_ID`, `VITE_GOOGLE_ADS_CONVERSION_ID`). If either is absent at build time, the corresponding script tag is omitted (keeps local dev clean).

### Firing

Thin wrapper in `apps/web/src/lib/gtag.ts`:

```ts
export function trackEvent(
  name: string,
  params?: Record<string, unknown>,
): void {
  // No consent gate here — Consent Mode v2 handles denied/granted
  // transparently inside gtag. We always emit; gtag decides what it's allowed
  // to send.
  window.gtag?.("event", name, params);
}
```

Form submission is two independent calls (fire-and-forget on the gtag side; the API call is what matters for our data):

```ts
await callApi(api.POST("/api/marketing/leads", { body }));

const params: Record<string, unknown> = {
  campaign_id,
  segment,
  send_to: `${ADS_CONVERSION_ID}/${conversionLabel}`,
  value: 0,
  currency: "GBP",
};

// Enhanced Conversions: only attach hashed email when ad_user_data is granted.
if (getConsent().ad_user_data === "granted") {
  params.user_data = {
    email_address: await sha256(email.toLowerCase().trim()),
  };
}

trackEvent("generate_lead", params);
```

Enhanced Conversions hashes user email client-side (SubtleCrypto). Hashed email is still personal data under UK GDPR, so it is only sent when the user has granted `ad_user_data` consent. Without it, the conversion still fires — just without the user identifier — and Google matches on `gclid` alone when possible.

### What gtag takes off our plate

- `gclid` capture from the URL automatically (with linker param handling).
- Cross-domain session stitching (not relevant yet, but free if it ever is).
- GA4 pageviews + engagement (enhanced measurement).
- Consent Mode v2 signalling.
- Conversion de-dup with the Ads API uploads (Google matches on `gclid` + conversion action + timestamp).

---

## 11. Offline conversion forwarder

Offline events (`lead_attended_session`, `lead_became_member`, sometimes `purchase`) originate in the admin UI or server-side webhook, hours to weeks after the click. They cannot use `gtag.js`. We upload via the Google Ads API.

### Where it runs

Start simple: a Fastify plugin registered at boot that schedules `drainOnce()` every 30 seconds via `setInterval`. Each tick:

1. `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 20` a batch of `pending` rows past their `next_attempt_at`.
2. Group by destination and call the client (Google Ads API Node SDK).
3. Update to `succeeded` / `failed` / `dead`.

This is fine for expected volume (tens of events/day). If volume or reliability demands grow, move to an ECS scheduled task modelled on `apps/api/src/sync-runner.ts`. Reversible either way.

### What it sends (Google Ads)

Each `ClickConversion` payload:

- `conversion_action` — resource name resolved from the campaign registry.
- `conversion_date_time` — ISO with timezone.
- `conversion_value` + `currency_code` — from the event (or campaign default).
- `order_id` — `event.id` for idempotency.
- **`gclid`** from `lead.attribution.gclid` when present. **Preferred**; it is the strongest signal and avoids sending any user identifier.
- **`user_identifiers`** (hashed email SHA-256) — **only** when `lead.consent_ad_user_data = 'granted'` and `gclid` is absent or we want to boost match rate. Skipped entirely when consent is denied.
- **`consent`** object — populated from `lead.consent_ad_user_data` and `lead.consent_ad_storage`:
  ```
  consent: {
    ad_user_data: GRANTED | DENIED | UNSPECIFIED,
    ad_personalization: GRANTED | DENIED | UNSPECIFIED,
  }
  ```
  `UNSPECIFIED` is used when the stored consent is `'unknown'` (e.g. legacy/admin-created leads predating this design).

### Consent-driven behaviour matrix

| `consent_ad_user_data` | `gclid` present | What we upload                                         |
| ---------------------- | --------------- | ------------------------------------------------------ |
| `granted`              | Yes             | Full payload: gclid + hashed email + Consent=granted   |
| `granted`              | No              | Hashed email only + Consent=granted                    |
| `denied`               | Yes             | gclid only + Consent=denied (no user_identifiers)      |
| `denied`               | No              | Skip upload entirely (nothing to match on, no consent) |
| `unknown`              | Yes             | gclid only + Consent=unspecified                       |
| `unknown`              | No              | Skip upload                                            |

### Attribution windows

Click-through and upload windows are derived from each conversion action's Ads configuration, not hard-coded:

- Click-through window: configured per-action in Google Ads (30 days for `generate_lead`, longer for `lead_attended_session` and `lead_became_member` which can reasonably take weeks).
- Upload window: Google Ads retains click data for up to 63 days from the click. Offline conversions referencing a `gclid` must reach Ads inside that window.
- **Admin UI**: for each `pending` offline event, compute `min(clickThroughWindow, 63 days)` from `lead.attribution.first_seen_at` and show a per-lead cutoff date. If the cutoff has passed, the outcome button marks the event without queueing an Ads upload.

### Retry & failure

- 4xx validation errors → `dead` immediately, logged, admin surfaces them.
- 5xx / 429 / network → retry with exponential backoff up to 6 attempts over ~24 hours.
- `dead` rows are visible in an admin debug view. Manual "retry" endpoint re-queues them.

### Idempotency

- `event.id` as `order_id` de-dupes on the Google side.
- `marketing_outbox` status transitions prevent double-uploads on our side.

---

## 12. Admin surfaces

All lead and event administration is `admin`-only. Junior managers do not see lead data. The `junior_manager` role's scope stays unchanged from today (dependents / team management).

### Extend `apps/web/src/pages/admin/contacts-tab.tsx`

Rename to a "Leads" tab. Columns:

| Email | Name | Source | Campaign | Segment | Status | Created | Outcome (buttons) |

Row actions: `Contacted` · `Attended` · `Joined` · `Lost`. Each click calls `POST /api/admin/leads/:leadId/outcomes`. Clicking `Joined` opens a small modal to optionally link an existing `member_id`.

Filters: campaign, segment, status, date range, search (name/email). Matches the existing `GET /api/admin/contact-submissions` pattern.

### New admin views

- **Events timeline** — per-lead, chronological. Read-only, useful for debugging attribution and duplicates.
- **Outbox** — list of `marketing_outbox` rows, filterable by status. Manual retry button for `dead`. Off the main admin nav; reachable via a deep link.

All gated by `requireRole("admin")`, matching every other admin route.

---

## 13. Frontend helpers

New files:

- `apps/web/src/lib/marketing/attribution.ts` — capture, read, write the cookie.
- `apps/web/src/lib/marketing/consent.ts` — consent state, banner state, Consent Mode v2 calls.
- `apps/web/src/lib/marketing/gtag.ts` — async loader + typed `trackEvent`.
- `apps/web/src/components/consent-banner.tsx` — the banner itself.
- `apps/web/src/components/lead-form.tsx` — reusable lead form primitive (campaign id + segment + fields + submit). Individual campaign pages compose this.

The existing typed API client (`apps/web/src/lib/api-client.ts`) does not change; it picks up the new endpoints automatically through `pnpm run openapi:generate`.

---

## 14. Shared types

`packages/shared/src/marketing/`:

- `attribution.ts` — `Attribution` type + Zod schema.
- `events.ts` — `marketingEventType` enum.
- `campaigns.ts` — campaign registry.
- `schemas.ts` — lead form schema, outcome schema, event schema.

This keeps frontend, backend, and tests in sync on a single typed contract.

---

## 15. Config additions (`apps/api/src/config.ts`)

Added to the existing Zod config schema:

```
GA4_MEASUREMENT_ID
GA4_API_SECRET                  -- only if we later send server-originated events to GA4
GOOGLE_ADS_DEVELOPER_TOKEN
GOOGLE_ADS_CUSTOMER_ID
GOOGLE_ADS_LOGIN_CUSTOMER_ID    -- optional, MCC
GOOGLE_ADS_SERVICE_ACCOUNT_JSON -- secret, store in AWS Secrets Manager per existing pattern
```

Frontend env (Vite):

```
VITE_GA4_MEASUREMENT_ID
VITE_GOOGLE_ADS_CONVERSION_ID
```

No flags for per-env disable; instead, if `GA4_MEASUREMENT_ID` is unset, the gtag loader stays inert. The forwarder likewise short-circuits if Ads creds are missing. Keeps local dev clean.

---

## 16. Consent, compliance, retention

### Lawful bases

- **Lead record**: legitimate interest + pre-contract. The user actively submitted a form to request something from us; responding is in-scope for that request.
- **Attribution cookie (`pm_attrib`) and Google Ads forwarding**: **consent**, granted via the banner and recorded in `pm_consent` with version and timestamp.
- **Analytics storage + Google Analytics measurement**: consent (same record).
- **`ad_user_data` (sending hashed email / identifiers to Google for conversion measurement)**: a distinct consent axis — see [§8 Consent](#8-consent-consent-mode-v2) and [§11 Offline conversion forwarder](#11-offline-conversion-forwarder). Granted only when the user accepts the banner; must be set on every Google Ads API `ClickConversion` via the `Consent` object.

### Privacy notice requirements

Must be updated before Phase 2 of rollout. Required content:

- **Processors named explicitly**: Google (Ads, Analytics), AWS, Better-Auth, New Relic, Slack, Stripe. Not "a third party".
- **What we collect**: lead data (name, email, phone, notes), cookie identifiers (`pm_consent`, `pm_attrib`, Google cookies), page/event data.
- **Why**: responding to enquiries, measuring recruitment campaigns, site analytics, service operation.
- **What Google specifically receives**: page events via `gtag.js`, hashed email when `ad_user_data` is granted, `gclid` for ad click matching, offline conversion uploads for admin-marked outcomes.
- **Consent Mode**: plain English — "Google's tag is loaded on every page. Until you accept, it sends traffic signals to Google with no identifiers attached so Google can measure ad performance in aggregate. If you accept, it also reads and writes identifiers that let us and Google measure specific users."
- **How to withdraw consent**: footer "Cookie settings" link, changes take effect immediately.
- **Retention**: as below.
- **Rights**: access, rectification, erasure, portability; address the trustees to exercise them.

### Service communications vs direct marketing

- Responding to a trial/enquiry form submission is a **service communication** — in-scope under the user's original request, not marketing.
- Newsletters, fundraising asks, seasonal recruitment reminders, sponsor promotions, and similar are **direct marketing** and need their own lawful basis (opt-in, or a documented charitable-purpose soft opt-in for existing members).
- The privacy notice must make this distinction so users know what to expect from a form submission (reply about your enquiry, nothing else) vs signing up to a marketing list (which, if it ever exists, is a separate consent).

### Retention

- `lead` and `marketing_event` rows kept 3 years, matching the existing member retention policy (membership + 36 months). Leads linked to a member inherit the member's retention.
- A nightly cleanup job deletes unlinked leads (+ cascaded events) older than 3 years — add in a later phase, not day 1.
- `marketing_outbox`: `succeeded` rows purged after 90 days; `dead` rows kept until manually cleared.
- Data subject requests are satisfied by deleting the `lead` row — events FK-cascade or are scrubbed.

---

## 17. Performance

- **LCP** — `gtag.js` loads on every page but is `async` and non-render-blocking. No LCP impact at measurable granularity.
- **INP** — a ~500-byte synchronous stub runs before `gtag.js`. Sub-ms. Attribution helper is a cookie read, also sub-ms.
- **CLS** — banner is bottom-fixed with a reserved `min-height`, no layout shift.
- **Transfer** — ~70 KB (gzipped, async) added to every page. Cached cross-session once loaded. Acceptable for the Ads modelling benefit (see §8 Pattern A rationale).
- **Server impact** — one extra transaction (3 row inserts) per lead. Negligible.
- **Forwarder overhead** — ~1 query every 30s on an idle Fastify instance. Negligible.

---

## 18. Trade-offs and risks

- **Client dependency on `gtag.js`.** We're tying primary online conversion fidelity to a Google-controlled script. Acceptable today (they run the ad network we care about). If we ever add Meta/LinkedIn ads, revisit — this is the point where server-side GTM earns its keep.
- **`gtag.js` loads for every visitor, including decliners (Pattern A).** ~70 KB async, no CWV impact, but a visible network request to a Google domain regardless of consent choice. Cookieless-mode pings continue on decline. The trade for this is Ads conversion modelling on non-consenting / pre-decision traffic — judged worth it (see §8). If club policy later shifts toward a stricter "no Google scripts until consent" stance, Pattern B is a small code change.
- **First-touch attribution.** Simpler and honest for grants campaigns, but attributes wrongly in the edge case where a user clicks two different ads before converting. Fine for v1.
- **Email-match dedup is imperfect.** Enhanced Conversions accepts hashed email as fallback, but gclid is the strong signal. Users with ad blockers / strict tracking protection will not have a gclid on arrival — those leads still get captured, just not credited to Ads.
- **Denormalised `lead.status`.** Must stay consistent with events. A small service helper (`setLeadStatus()`) wraps the update so the pattern is enforced.
- **In-process forwarder coupled to the web process.** A web deploy restart could interrupt a batch mid-upload. Idempotency (`order_id = event.id`) covers it. If we grow, promote to an ECS scheduled task.
- **Campaigns in code, not DB.** Requires a dev to ship a PR for each new campaign. Acceptable while the club has one dev-facing owner.
- **Consent Mode v2 UX.** A banner _will_ appear on the site. Wording and placement are worth the club's input before launch.

---

## 19. Rollout plan

Each phase is independently deployable, independently valuable, and reversible.

### Phase 1 — Schema & attribution plumbing (no user-visible change)

- Migration for `lead`, `marketing_event`, `marketing_outbox`.
- `packages/shared/src/marketing/*` primitives.
- `attribution.ts`, `consent.ts`, consent banner, `gtag.ts` loader (inert without env vars).
- Privacy page updated.
- Banner shows on every page. No events fire yet.

### Phase 2 — Generic lead capture API + admin surface

- `POST /api/marketing/leads` (+ Zod) .
- Shared `emitMarketingEvent` service factory.
- Existing contact form wired to also emit `contact_form_submitted`.
- Stripe webhook emits `purchase` events; best-effort lead match.
- Admin leads tab with outcome buttons (events only; no Ads upload yet).
- **Validation gate**: submit test leads, click outcomes, verify DB rows + admin view.

### Phase 3 — GA4 via gtag.js, no Ads

- Enable `gtag.js` load with GA4 measurement ID only.
- Fire `generate_lead`, `purchase`, `sign_up` through `gtag`.
- Use GA4 DebugView for 48 hours.
- **Validation gate**: GA4 shows events, correct segments, correct counts. No Ads account is even connected yet.

### Phase 4 — Google Ads online conversions, soft launch

- Add Ads conversion ID, fire conversion send_to in `gtag`.
- In Ads, create conversion actions in **Secondary** (observation) column.
- **Bidding.** Ad Grants accounts created after 2019-04-22 are required to use conversion-based Smart Bidding; Manual CPC is not permitted. If the account has no conversion history yet, launch on **Maximize Clicks** as a short, documented bootstrap phase to gather traffic. Do **not** set any automated-bid conversion action while conversion tracking is still being validated (that's the whole point of Secondary-column launch).
- **Validation gate**: Ads conversion counts match DB counts within 5% over 2 weeks.

### Phase 5 — Offline forwarder + outcome uploads

- Forwarder drain loop.
- Upload `lead_attended_session` and `lead_became_member` via Ads API.
- Admin outbox view + retry.
- **Validation gate**: offline uploads succeed end-to-end in sandbox, then prod with a single real lead.

### Phase 6 — Promote to primary bidding

- Move `generate_lead` to **Primary** conversion in Ads.
- Switch from Maximize Clicks to **Maximize Conversions** now that there's enough signal. (Maximize Conversion Value is an option once `lead_became_member` starts landing and values are trusted; stick with Maximize Conversions first.)
- Weekly CPA review.

### Phase 7 — Operational polish (as needed)

- Retention cleanup job.
- Promote campaign registry to DB if non-devs need to edit.
- Evaluate Google Tag Gateway (first-party gtag delivery) or full server-side GTM if traffic/ad-blocker impact warrants.

---

## 20. What's explicitly deferred

- **Server-side GTM on Cloud Run.** The "correct" endgame for first-party everything. Deferred because it requires new infra (GCP project, Cloud Run container, ≥3 instances for redundancy per Google's own guidance) and the marginal gain over Consent Mode v2 + Enhanced Conversions + Google Tag Gateway is small at our scale.
- **Google Tag Gateway.** First-party gtag delivery via a GCP-managed CDN. Evaluate once we have real traffic + ad-blocker impact data.
- **Meta / LinkedIn / TikTok conversion APIs.** Straightforward to add — another destination in the outbox. Not on roadmap.
- **Per-vendor consent toggles.** One-button banner is fine for a Google-only setup. If we add more destinations, revisit.
- **Session-level attribution.** Only storing first-touch campaign attribution on the lead. No session stitching, no last-touch layering.

---

## 21. Operational notes for Phase 1

Items that aren't code but must be handled during the first phase of dev:

- **Google Ads account access** — customer ID `882-123-5703` ($10k/month Ad Grants budget), sole admin `alex.young@percymain.org`. Single-admin bus factor is a known risk; add at least one more trustee as admin before going live.
- **Developer token + OAuth refresh token** — apply for API access on the Ads account (Google approval typically takes 2–5 working days for "basic" tier, which is sufficient for our volume). Generate OAuth2 refresh token tied to the admin Google account; store creds in AWS Secrets Manager per the existing Stripe/SES pattern.
- **GCP project** — create a single consolidated `percy-main-marketing` project. Used initially for the Ads API service account; any future sGTM deployment would live in the same project.
- **Privacy page rewrite** — signed off by the tech lead (Alex); no external legal review needed for this scope. Drops Retool, adds AWS, New Relic, Better-Auth (cloud), Google Ads, Google Analytics, Slack as disclosed processors. Published before Phase 2 of the rollout — must be live before real data flows under the new design.
