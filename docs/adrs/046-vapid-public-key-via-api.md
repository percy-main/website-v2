# ADR 046: VAPID public key delivered via API, not bundled

## Status

Accepted

## Context

Web Push needs a VAPID keypair on the application server. The private half signs JWTs that authenticate this server to browser push services (FCM, Apple, Mozilla autopush). The public half is sent inside `PushManager.subscribe({ applicationServerKey })` so the push service can verify those signatures later.

The public half is not a secret. It identifies us to the push service; anyone with it still cannot send a push without the matching private key. So we had a choice in how the matchday SPA gets at it before subscribing:

1. Bake into the Vite bundle as `VITE_VAPID_PUBLIC_KEY`.
2. Fetch from a public API endpoint at subscribe time.

## Decision

The API exposes `GET /api/push/public-key` (no auth required) that returns `{ publicKey }`. The matchday hook `enablePushOnThisDevice()` calls it just before `pushManager.subscribe()` and feeds the result into `applicationServerKey`. The key value lives in SSM (`/<env>/percy-main/VAPID_PUBLIC_KEY`) and is read into the API config at boot.

## Problem

Three constraints shaped the call:

- **Two apps share the API.** Both `apps/web` and `apps/matchday` are Vite builds with their own envs. Baking the public key into the bundle means two `VITE_VAPID_PUBLIC_KEY` slots, two CI-injection points, and two ways for them to drift out of sync with the API's actual keypair.
- **Key rotation must be cheap.** If we ever rotate VAPID (compromise, key-format migration), we want operators to flip an SSM value and roll the API task. Forcing a matchday rebuild + redeploy to pick up a new bundled constant turns rotation into a multi-step coordination problem.
- **The fetch is not hot path.** A subscriber calls `pushManager.subscribe()` at most a handful of times per device (first opt-in, occasional re-subscribe). One extra HTTP request before that is invisible cost.

## Options considered

1. **`GET /api/push/public-key` returning `{ publicKey }`** (chosen). Public endpoint, no auth, served from the same API as the rest of matchday.
2. **`VITE_VAPID_PUBLIC_KEY` baked into the matchday bundle.** Single HTTP request saved on first subscribe; cost paid on every key rotation.
3. **Include the public key in an existing me-shaped endpoint** (e.g., as a field on `GET /api/me/notification-preferences`). Saves a request but couples two concerns and means anonymous visitors who want to opt in can't read it. Currently moot because we require auth before showing the toggle, but future "subscribe before sign-up" flows would re-open it.

## Rationale

- **One source of truth.** SSM holds the key; both apps and the API read from the API; rotation is "update SSM, redeploy API task." No bundle-rebuild step. No version skew between bundle and API.
- **Cheap fetch.** Subscribe happens once-ish per device. An extra ~50ms before a permission prompt is unnoticeable next to the prompt itself.
- **Public-by-design.** The key has no confidentiality requirement and the endpoint has no other side effects. There is nothing to lock behind auth and no rate-limit story to worry about.
- **Symmetric with the private half.** Private key + subject already come from the same Secrets Manager blob the API reads at boot; the public half routing through the same boot path means all three VAPID values are validated together at startup (per the `feedback_required_env_vars` rule - new env vars must be required, not optional).

## Rejected alternatives

- **Bundle-embedded `VITE_VAPID_PUBLIC_KEY`** - rejected because rotation cost compounds across two apps and CI envs. Would become attractive if we needed offline-first subscription (no API reachable), which we do not.
- **Embedded in `/me/notification-preferences`** - rejected because it couples user-prefs to a piece of platform config and assumes the caller is authenticated. Easy to merge later if a use case shows up; cheap to keep separate now.

## Related

- Public key SSM parameter: `/staging/percy-main/VAPID_PUBLIC_KEY`, `/production/percy-main/VAPID_PUBLIC_KEY` (defined in `infra/environments/<env>/secrets.tf`).
- Private key + subject live in the `app_secrets` Secrets Manager blob and are read by `createPushSender` (`apps/api/src/lib/push-sender.ts`).
- All three VAPID values are required by `apps/api/src/config.ts` - the API will fail fast at boot if any is missing.
