# Decision 052: Publish-Time Prerendering via Lambda + CloudFront KeyValueStore

**Date:** 2026-07-03
**Status:** Accepted

## Decision

Public content (CMS pages, news articles, people profiles, events) is rendered to static HTML at publish time by a "prerenderer" Lambda built from the web app's own SSR bundle, stored under `_prerender/` in the frontend S3 bucket, and served as the initial document to everyone - users and crawlers - via a CloudFront KeyValueStore lookup in the existing viewer-request function. The SPA seeds react-query from state embedded in the document, resolves the matched route's lazy module, then renders over the prerendered DOM in a single, visually identical commit. Game reports keep their existing OG-redirect mechanism.

One diff-driven `reconcile` action covers the whole lifecycle: the Lambda fetches a manifest of live content from the API, diffs it against a state file, renders what changed and tears down what vanished. A change to the nav (which is baked into every document's header/sidebar) escalates to a full re-render. Triggers: async invoke from the API on publish-path mutations, a render-all from deploy-web on every web deploy (asset hashes change), and a 15-minute EventBridge sweep as the backstop for scheduled publishes, lost triggers and drift.

## Problem

The public site was a pure client-rendered SPA. Three consequences:

1. Menus and content loaded in gradually - the nav is derived from published pages via an API call, and content pages showed a spinner while `by-path` resolved.
2. No per-page meta tags: every URL shipped the same generic `<title>`/OG tags, so shared links (WhatsApp/Facebook - a club's main channels) always showed the site-generic card, and there was no sitemap, robots.txt or JSON-LD.
3. Crawlers that don't execute JavaScript saw an empty shell.

Publishing had to stay instant (seconds), and the club runs on volunteer time and free-tier-conscious AWS spend.

## Options considered

1. **Publish-time prerendering (chosen).** Render on publish into S3; route via KVS at the edge; SPA takes over client-side.
2. **Full SSR migration** - react-router framework mode (or similar) rendered by a Node service on ECS/Lambda behind CloudFront.
3. **Crawler-only dynamic rendering** - UA-sniff bots in the CloudFront Function (the game-report OG redirect already does this) and serve them API-generated snapshots; keep users on the SPA.
4. **CI rebuild-on-publish (classic SSG)** - publish triggers a GitHub Actions build that prerenders the whole site and redeploys.

## Rationale

- Fixes all three problems for **everyone**, not just bots: real content and the full menu are in the first byte of HTML, per-page title/OG/JSON-LD are correct, and crawlers get plain static documents plus a sitemap.
- Keeps the existing hosting model (S3 + CloudFront, no always-on page server) and publishing latency (seconds).
- The renderer being the web app's own SSR bundle (`vite build --ssr`, `ssr.noExternal: true`) means zero dual-renderer maintenance across the 13+ custom block types, markup that matches the client render, and - because it's built and shipped by `deploy-web` alongside the client bundle - hashed asset references that always agree (a CI check asserts this).
- The empty-KVS state is byte-identical to historical behaviour, which gives incremental rollout and an instant rollback (delete keys, unset `PRERENDER_ENABLED`).
- Failure degrades gracefully: a dead renderer means new content serves via CSR fallback and edited content serves a stale snapshot that the SPA immediately refetches over.
- Render-over instead of `hydrateRoot`: the app has guaranteed root-level mismatch sources (theme-derived icons, locale/timezone date formatting, session timing), and React 19 recovers from root mismatches by re-rendering the whole tree client-side anyway - so hydration would buy console noise, not correctness. Requires resolving the matched lazy route module before the first render, or React's first commit wipes the prerendered DOM.

## Rejected alternatives

- **Full SSR migration**: the cleanest long-term architecture (per-route `meta`/loaders eliminate this machinery), but a large app migration plus a new always-on runtime to operate and pay for. Becomes attractive if the SPA is ever rewritten wholesale or if personalised server-rendered pages are needed.
- **Crawler-only dynamic rendering**: least effort, but users never get content on first paint (problem 1 unsolved), it needs a hand-rolled BlockNote-to-HTML renderer maintained in parallel with the React one, and Google documents dynamic rendering as a workaround. Reconsider only as a stopgap if the render-over approach had proven unworkable.
- **CI rebuild-on-publish**: simplest machinery and atomic regeneration, but 5-10 minutes publish-to-live (a regression from seconds), CI minutes per publish, and scheduled publishes would need scheduled builds. Becomes attractive if publish frequency drops to near-zero and the Lambda pipeline proves burdensome.
- **Per-item EventBridge one-shot schedules for scheduled publishes**: rejected in favour of the 15-minute sweep - content is live instantly via CSR fallback either way (the query layer gates visibility by `published_at`), so one-shots would add scheduler IAM and cancellation bookkeeping to shave minutes off snapshot latency nobody can see.
- **SQS between API and Lambda**: async Lambda invoke already gives 2 retries and an on-failure destination to the alarms topic; a queue is overengineering at a few publishes a week.

## Operational notes

- **Rollout**: deploy with `PRERENDER_ENABLED` unset (empty KVS = no behaviour change) → invoke `{"action":"render","url":"/club"}` manually → verify `curl https://www.percymain.org/club` shows content + meta → set the repo variable.
- **Rollback**: delete all KVS keys and unset `PRERENDER_ENABLED`; snapshots in S3 are inert.
- **Deploy ordering is load-bearing**: `deploy-web` uploads new assets WITHOUT `--delete`, updates the Lambda code, re-renders every snapshot synchronously, and only then removes stale assets (with `_prerender/*` and `sitemap.xml` excluded). Collapsing this back to a single `--delete` sync would serve snapshots referencing deleted scripts for the re-render window - or delete every snapshot outright if the excludes are dropped.
- **Local preview**: `apps/web/scripts/prerender-preview.mjs` renders any URL through the full pipeline minus AWS.
