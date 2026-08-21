# Decision 059: Push Subscriptions Are Dropped, Not Re-Keyed, When the Account Changes

**Date:** 2026-08-21
**Status:** Accepted

## Decision

A browser push subscription belongs to the account that explicitly enabled it,
and never transfers. On sign-out the matchday PWA tears the subscription down
before destroying the session. When the app boots as a different user, the
subscription is reconciled against the server and dropped unless that endpoint
is registered to the user who is signed in now. The new user sees "not enabled
for this account" and an Enable button; nothing re-keys silently.

Push state is no longer read from the browser alone. `GET
/api/me/push-subscriptions` returns the caller's own endpoints, and the client
reports `subscribed: true` only when its local endpoint appears in that list.

## Problem

`PushManager` has no notion of accounts (#633, severity medium). The
subscription is scoped to the origin, so on a shared device it outlived
sign-out: the API row still pointed at user A, the browser still held A's
endpoint, and the UI read "subscribed" purely from
`registration.pushManager.getSubscription()`. User B signed in, saw a
subscribed device, never registered an endpoint of their own, and A's matchday
alerts kept arriving on B's phone.

## Options considered

1. **Drop on account change; require an explicit re-enable (chosen).**
   Sign-out deletes the row and unsubscribes locally; an identity change
   unsubscribes anything the server does not confirm as the current user's.

2. **Silently re-key the endpoint to the new user.** One fewer tap for
   returning users on a shared device, and the row moves in a single upsert
   (`upsertPushSubscription` already re-keys on endpoint conflict).

3. **Server-side only: delete every row for the departing user at sign-out.**
   No client changes, but it kills that user's push on _every_ device they own
   because a session has no idea which endpoint belongs to the device in hand.

## Rationale

Notifications are a consent decision, not a device setting. Re-keying would
start pushing club alerts to someone who never asked for them, on the strength
of nothing more than sharing a browser profile with a teammate - and the
notification would look like it came from an app they had configured. The
extra tap is a one-time cost paid only by users who switch accounts on a
shared device.

Dropping needs both halves. Deleting the server row alone leaves a live
endpoint the push service still accepts; unsubscribing locally alone leaves a
row that dispatch keeps trying. The sign-out path does both while the
departing user's cookie is still valid, so the ordering (push teardown first,
`authClient.signOut()` second) is load-bearing. Clearing the stashed VAPID
config matters just as much: without it the `pushsubscriptionchange` recovery
handler added in PR #444 would re-subscribe and re-register the device for
whoever is signed in next.

When the session is switched without going through our sign-out, the departing
user's row cannot be deleted (we are authenticated as somebody else by then).
Unsubscribing at the push service is enough: the next dispatch gets 404/410 and
`deletePushSubscriptionByEndpoint` prunes the row, which is the same path a
browser-expired subscription already takes.

Ownership is decided by the server, not by the `matchday-last-user-id`
localStorage hint, which is only a cache-hygiene optimisation and is routinely
absent (Safari evicts it). Asking the API "is this endpoint mine?" makes a
returning user's own subscription survive an eviction, and still drops a
stranger's.

## Trade-offs

- **An unverifiable answer counts as "not yours", and that is destructive.**
  If the endpoint list cannot be fetched (offline, 401, 5xx) the UI reports
  not-subscribed, and reconciliation on an identity change goes further: it
  unsubscribes the local subscription. That is deliberate, because
  reconciliation gets one attempt - `ensureCachesMatchUser` rewrites
  `matchday-last-user-id` on the same boot, so later boots see no mismatch and
  never retry. Skipping the drop when offline would leave the previous user's
  alerts arriving on this device indefinitely, which is the bug being fixed.
  The cost is a false positive when the device was still the same user's and
  the last-user hint had been evicted: they lose push until they re-enable.
  Recovery is one tap - Enable reuses the existing browser subscription and
  re-registers the endpoint - and the card shows an Enable button, so the
  state is at least visible rather than silent.
- **An expired cookie does not drop the subscription.** `ensureCachesMatchUser`
  skips reconciliation when nobody is signed in, because a session that simply
  ended is usually a personal device whose owner is about to sign back in, and
  silently disabling their notifications is worse than the leak window. The
  leak closes when the _next_ user signs in, before any UI renders.
- **Reconciliation is not awaited.** It runs a network call, and the
  `<RequireAuth />` render gate must not block on the network in a PWA that
  boots offline. Rendering is gated on the cache wipe only, as before.
