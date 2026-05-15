# Dev Review: Matchday PWA Plan

**Reviewed:** 2026-04-23
**Files read:** PLAN.md, phases/1-6, \_research/inventory.md, \_research/better-auth-xsub.md, \_research/infra.md, apps/api/src/features/auth/auth.ts, apps/api/src/features/auth/middleware.ts, apps/api/src/app.ts, apps/web/src/lib/auth-client.ts, apps/api/src/features/matchday/routes.ts, apps/api/src/config.ts, package.json (root + apps/web), infra/modules/cdn/main.tf, infra/environments/production/main.tf

**Verdict: Go with changes.** The frontend-only split is the right call. The API surface is nearly complete for everything the new app needs. However, there are concrete incorrect assumptions and missing scope items that will cause rework mid-phase if not addressed before phase 1 starts. None are blockers to the overall approach; all are fixable in a day or two of pre-phase work.

---

## Incorrect assumptions in the plan

### 1. "Existing OpenAPI spec covers everything we need" — PLAN.md §6

Directly contradicted by phase 2's own risks section. `GET /matchday/:matchId` has `preHandler: [officialRole]` at `apps/api/src/features/matchday/routes.ts:94`. A player-role user calling it gets a 403. The plan correctly identifies the need for `GET /matchday/:id/public` in the phase 2 risks section, but PLAN.md §6 claims the spec is complete. Remove the claim from §6 and add the new endpoint to the backend changes list alongside the team-news-image role change.

### 2. CORS expansion is not just an `apps/api/src/app.ts` change

`apps/api/src/app.ts:125` reads `origin: config.BASE_URL`. That config field is a single `z.url()` in `apps/api/src/config.ts:23`. Expanding it to accept multiple origins requires all of:

1. A new field in `config.ts` (e.g. `MATCHDAY_URL: z.url().optional()`)
2. Updated `app.ts` to build an array: `[config.BASE_URL, config.MATCHDAY_URL].filter(Boolean)`
3. A new SSM parameter in `infra/environments/production/main.tf`
4. The new parameter passed to the ECS module's `environment_variables` block
5. A Terraform apply before the matchday SPA goes live

The same chain applies to adding `matchday.percymain.org` to `trustedOrigins` in `auth.ts:23` — `matchday` URL is not currently in config at all. The phase 1 change list must include the config schema step or the CORS and CSRF protection will silently fail on deploy.

### 3. `openapi:generate` is hardcoded — phase 1's acceptance criterion cannot be met as written

Root `package.json:26`:

```
"openapi:generate": "pnpm --filter api exec tsx src/generate-openapi.ts > apps/web/src/lib/api.gen.json && pnpm exec openapi-typescript apps/web/src/lib/api.gen.json -o apps/web/src/lib/api.gen.d.ts"
```

Output paths are hardwired to `apps/web/src/lib/`. The phase 1 acceptance criterion states `pnpm run openapi:generate emits the matchday client too (or imports from apps/web via tsconfig paths — document which)`. Neither option is implemented automatically. This needs a deliberate choice and a script change before phase 1 can close.

Recommendation: extend the script to emit a second copy at `apps/matchday/src/lib/api.gen.*`. Both apps get the same spec from the same generator. The tsconfig-paths approach couples build graphs — when the matchday app eventually wants to trim unused endpoints for bundle size, you'll need divergence anyway. Start with duplication.

### 4. The infrastructure option A dismissal is based on a false premise

PLAN.md §8:

> "CloudFront routes by path not host on the same distribution, so this means invasive routing config. Skip."

This is incorrect. The existing distribution already serves multiple hostnames using `aliases` — `percymain.org`, `www.percymain.org`, `kit.percymain.org` (`infra/environments/production/main.tf:192`). Adding `matchday.percymain.org` as a fourth alias with a new S3 origin is exactly what the CDN module's existing structure supports: the `extra_aliases` variable, and a new `origin` block plus `ordered_cache_behavior` in `infra/modules/cdn/main.tf`. The existing `aws_cloudfront_origin_access_control.s3` (`main.tf:264`) can be reused. The existing SPA-rewrite CloudFront Function needs extending or duplicating for the matchday origin, which is a small change.

What a separate distribution (option A) actually costs:

- A second WAF association, or matchday is unprotected by the WAF
- A second logging bucket entry, or manual shared-bucket wiring
- Two `DISTRIBUTION_ID` secrets in CI and two invalidation calls per deploy
- A separate Terraform resource lifecycle — teardown is no longer atomic

The existing module is built to be extended. Add the matchday S3 bucket as a new origin and ordered behavior in the CDN module, add `"matchday.percymain.org"` to `extra_aliases` in the production env, run one `terraform apply`. That is option B, it works, and it is strictly simpler.

### 5. `match_fee_rate` CRUD endpoint does not exist

Phase 4 says "check whether a CRUD endpoint on `match_fee_rate` exists; if not, small backend addition." The full inventory of matchday and admin routes does not list one. The current admin tab in `apps/web/src/pages/admin/match-fees-tab.tsx` either calls an unlisted internal route or mutates rates another way. Either way, phase 4 needs this backend work scoped explicitly. Budget a half-day for schema + service + route + `openapi:generate`.

---

## Missing scope / hidden work

### A. Phase 1 estimate is undercooked

The "~1 week" estimate does not account for:

- `config.ts` schema change → SSM → Terraform apply (2–3 hours with a prod infra touch)
- better-auth version upgrade and validation (see auth section below)
- Passkey RP ID audit: check the `passkey` table for registered keys; if non-empty, coordinate user communication before changing `BETTER_AUTH_RP_ID` in SSM
- `openapi:generate` script extension
- Real iOS Safari testing in a hosted staging environment (not localhost) — this is on the acceptance criteria list and cannot be shortcut

More realistic: 1.5–2 weeks for one engineer. Budget +3 days if the Safari ITP fallback (reverse-proxy path) is needed.

### B. `BETTER_AUTH_RP_ID` production value is unknown

`infra/environments/production/main.tf:161` passes `BETTER_AUTH_RP_ID` from an SSM parameter. `apps/api/src/config.ts:21` defaults to `"localhost"`. The plan says set it to `percymain.org`, but doesn't check what it currently is in SSM. If it is already `percymain.org`, no passkeys are invalidated. If it is anything else (e.g. `api.v2.percymain.org`, which the old docs might have used), changing it invalidates all existing passkeys. This needs a check before phase 1's Terraform apply, not listed as an afterthought in the risks section.

### C. Email templates deep-link to main-site routes — a backend change is required

`ChargeNotification` (fired from `POST /matchday/:id/finish`) sends players a link to log in. The link URL is assembled in `apps/api/src/features/matchday/service.ts` and currently points to the main-site login. Phase 6 calls out updating email templates, but does not scope it as a service-layer change. The charge notification login URL needs to become `matchday.percymain.org` (or at minimum `percymain.org/login?redirect=matchday.percymain.org/fees`) once the cutover happens. This is a backend string change, not a frontend task. Needs an explicit PR in phase 6.

### D. The availability → matchday bridge must be read before phase 3 starts

Phase 3 risks say "need to check whether `POST /availability/requests/:id/dates/:date/confirm` translates into matchday rows." The inventory describes it returning `{fixtureIds: string[]}` with a note "creates matchday fixtures?" — deliberately left ambiguous. This is a known unknown that will block the "start squad from assignments" phase 3 feature if it doesn't create matchday rows. Read `apps/api/src/features/availability/service.ts` around this endpoint before phase 3 sprint planning, not during implementation.

---

## Technical alternatives worth considering

### auth-client baseURL strip — extract to shared utility

`apps/web/src/lib/auth-client.ts:8` strips `/api` from `VITE_API_URL` with a regex. The matchday app needs the same logic. Rather than duplicating the regex (and the comment explaining why), extract it to `packages/shared/src/auth-client-url.ts`. One place, one test.

### Offline write queue — persist to IndexedDB, not just memory

Phase 5's in-memory fallback for Safari loses queued writes if the user backgrounds the app or the tab is killed while offline. For `mark-paid` and `availability/respond`, that is silent data loss with a false optimistic indicator still showing. Workbox's `BackgroundSyncPlugin` uses IndexedDB internally; for the Safari in-memory fallback, also persist the queue to IndexedDB. The additional code is roughly 20 lines and makes the fallback production-grade rather than "works well enough."

---

## Specific code/config changes the plan glosses over

| File                                           | Change needed                                                                                               | Phase |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----- |
| `apps/api/src/config.ts`                       | Add `MATCHDAY_URL: z.url().optional()`                                                                      | 1     |
| `apps/api/src/app.ts:125`                      | `origin: config.BASE_URL` → `origin: [config.BASE_URL, config.MATCHDAY_URL].filter(Boolean)`                | 1     |
| `apps/api/src/features/auth/auth.ts:23`        | Add matchday URL to `trustedOrigins`; add `advanced.crossSubDomainCookies`; add `advanced.useSecureCookies` | 1     |
| `infra/environments/production/main.tf:192`    | Add `"matchday.percymain.org"` to `extra_aliases`; add SSM param + ECS env var for `MATCHDAY_URL`           | 1     |
| `infra/modules/cdn/main.tf`                    | Add matchday S3 bucket, origin block, ordered cache behavior (if extending the existing distribution)       | 1     |
| `package.json:26`                              | Extend `openapi:generate` to also emit `apps/matchday/src/lib/api.gen.*`                                    | 1     |
| `apps/api/src/features/matchday/routes.ts:92`  | Add new `GET /matchday/:matchId/public` with `requireAuth` only, reduced response schema                    | 2     |
| `apps/api/src/features/matchday/routes.ts:112` | Change `preHandler: [officialRole]` to `[adminRole]` on team-news-image route                               | 4     |
| `apps/api/src/features/matchday/` (new files)  | `match_fee_rate` CRUD: `schemas.ts` additions, service functions, routes                                    | 4     |
| `packages/email/` + `service.ts`               | Update `ChargeNotification` login URL to `matchday.percymain.org/fees`                                      | 6     |

---

## Severity-tagged issue list

### Critical

**C1. Phase 2 team-sheet view will 403 for every player without a backend change**
`GET /matchday/:matchId` is `officialRole`-gated at `routes.ts:94`. PLAN.md §6's claim that "the existing OpenAPI spec covers everything" is false. `GET /matchday/:matchId/public` must be added before phase 2 ships. Scope it into phase 1's backend PR so the generated types are available from day one of phase 2.

**C2. `openapi:generate` will not emit the matchday client — phase 1 acceptance criterion cannot be met as written**
`package.json:26` is hardcoded to `apps/web/src/lib/`. Every phase that calls the API is blocked until the script is extended. Decide on duplication vs tsconfig-paths before phase 1 starts, then implement it in the scaffold PR.

**C3. CORS expansion requires `config.ts` + SSM + Terraform, not just `app.ts`**
Missing from the phase 1 change list. If the Terraform apply does not land before the SPA goes live, every matchday API call gets CORS-blocked. No visible error until the first real browser hit.

### High

**H1. Infrastructure: extend the existing distribution, don't create a new one**
PLAN §8's dismissal of option B rests on incorrect CloudFront behaviour. The existing module already supports what is needed. A separate distribution adds CI complexity, WAF re-wiring, and a second Terraform lifecycle for no isolation benefit at this traffic volume.

**H2. better-auth upgrade must be a hard phase-1 gate**
PLAN §7 says "plan to upgrade before ship." The `advanced.crossSubDomainCookies` block is the entire auth strategy. If 1.6.7 has breaking changes in the cross-subdomain path (the research notes PR #6359 was "recently merged but still under review"), you need to know in phase 1, not phase 5. Make the upgrade and cross-subdomain staging test a prerequisite for phase 2 work starting.

**H3. `match_fee_rate` CRUD is unscoped backend work**
Phase 4 defers it to a "check if it exists" note. It does not exist. Add it to the phase 4 scope estimate. One engineer, half a day.

**H4. Phase 1 estimate does not account for the Terraform chain**
Config schema change → SSM parameter → Terraform variable → ECS env var → plan + apply is 2–3 hours of careful work that touches production infrastructure. "~1 week" needs to include this explicitly or the sprint will overrun.

### Nice-to-have

**N1. Resolve the availability → matchday bridge before phase 3 sprint planning**
Read `apps/api/src/features/availability/service.ts` for the `confirm` endpoint. One afternoon now avoids a mid-sprint replan.

**N2. Offline write queue should persist to IndexedDB**
Phase 5's in-memory Safari fallback loses queued writes on tab kill. IndexedDB persistence is roughly 20 additional lines in the Workbox setup.

**N3. Phase 2 and 3 parallelism has a hidden dependency**
Both phases need `GET /matchday/:matchId/public` to close their team-sheet acceptance criteria. One engineer must cut that backend PR first. Document this as a sequencing constraint in the phase 1 PR description.

**N4. Auth client URL strip belongs in `packages/shared`**
The regex in `apps/web/src/lib/auth-client.ts:8` will be duplicated in `apps/matchday`. Extract it before the matchday client is scaffolded.

**N5. Tech debt item #1 (role-check in services) is mildly worsened**
The new `GET /matchday/:matchId/public` endpoint should be designed to not call `getAccessibleTeamIds` without a corresponding middleware gate. Add a comment in the PR linking to inventory §7.1 so the pattern is not silently repeated.

---

The plan is solid work. Fix the CORS/config chain, fix the `openapi:generate` script, correct the infrastructure recommendation, add the `public` endpoint to phase 1's backend PR, and audit the RP_ID value before Terraform apply. After those changes, phase 1 is executable.
