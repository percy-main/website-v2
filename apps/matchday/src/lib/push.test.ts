/**
 * Shared-device account switching (issue #633).
 *
 * A PushSubscription lives in the browser, not in the session, so
 * without the wiring exercised here it survives a sign-out: the next
 * person to sign in on the device sees "subscribed" while the pushes
 * keep going to the account that registered the endpoint.
 *
 * The environment is `node`, so the DOM surface these modules touch
 * (service worker registration, PushManager, Cache storage,
 * localStorage, Notification) is stubbed below. The fakes are
 * deliberately dumb: the behaviour under test is *which* calls happen
 * and in what order, not how a real push service behaves.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared with the vi.mock factory below, which is hoisted above the
// imports - hence vi.hoisted rather than a plain const.
const backend = vi.hoisted(() => ({
  /** endpoint -> the account it is registered to, server-side. */
  rows: new Map<string, { userId: string; userAgent: string | null }>(),
  /** Who the session cookie authenticates as for the next call. */
  currentUserId: null as string | null,
  /** Flip to false to simulate the PWA being offline. */
  online: true,
  /** Ordered log of API + auth calls, for asserting sequencing. */
  calls: [] as string[],
}));

const authSignOut = vi.hoisted(() =>
  vi.fn(() => {
    backend.calls.push("auth signOut");
    backend.currentUserId = null;
    return Promise.resolve({ data: null, error: null });
  }),
);

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    signOut: authSignOut,
    useSession: () => ({ data: null, isPending: false }),
  }),
}));

vi.mock("@/lib/api-client.js", () => {
  const ok = <T>(data: T) => Promise.resolve({ data, error: undefined });
  const fail = (message: string) =>
    Promise.resolve({ data: undefined, error: { error: message } });

  const requireSession = () => {
    if (!backend.online) return "offline";
    if (!backend.currentUserId) return "Unauthorized";
    return null;
  };

  return {
    API_BASE: "/api",
    callApi: async <T>(pending: Promise<{ data?: T; error?: unknown }>) => {
      const { data, error } = await pending;
      if (error !== undefined) throw new Error(JSON.stringify(error));
      return data;
    },
    api: {
      GET: (path: string) => {
        backend.calls.push(`GET ${path}`);
        if (path === "/api/push/public-key") {
          if (!backend.online) return fail("offline");
          return ok({ publicKey: VAPID_PUBLIC_KEY });
        }
        const denied = requireSession();
        if (denied) return fail(denied);
        return ok({
          subscriptions: [...backend.rows.entries()]
            .filter(([, row]) => row.userId === backend.currentUserId)
            .map(([endpoint, row]) => ({
              id: `sub-${endpoint}`,
              endpoint,
              userAgent: row.userAgent,
              createdAt: new Date("2026-08-01T10:00:00.000Z").toISOString(),
            })),
        });
      },
      POST: (
        path: string,
        init: { body: { endpoint: string; userAgent?: string } },
      ) => {
        backend.calls.push(`POST ${path}`);
        const denied = requireSession();
        if (denied) return fail(denied);
        // Mirrors upsertPushSubscription: the endpoint is unique, so
        // re-registering it re-keys the row onto the caller.
        backend.rows.set(init.body.endpoint, {
          userId: backend.currentUserId ?? "",
          userAgent: init.body.userAgent ?? null,
        });
        return ok({ id: `sub-${init.body.endpoint}` });
      },
      DELETE: (path: string, init: { body: { endpoint: string } }) => {
        backend.calls.push(`DELETE ${path}`);
        const denied = requireSession();
        if (denied) return fail(denied);
        const row = backend.rows.get(init.body.endpoint);
        // The API scopes the delete to the caller's own rows.
        if (row?.userId !== backend.currentUserId) {
          return ok({ deleted: false });
        }
        backend.rows.delete(init.body.endpoint);
        return ok({ deleted: true });
      },
    },
  };
});

// A real VAPID public key shape (base64url, 65 raw bytes) so the
// base64 -> bytes -> base64 round trip in push.ts runs for real.
const VAPID_PUBLIC_KEY =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

interface FakeSubscription {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer };
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
  unsubscribe: () => Promise<boolean>;
}

function createPushManager() {
  let issued = 0;
  const manager = {
    current: null as FakeSubscription | null,
    getSubscription: () => Promise.resolve(manager.current),
    subscribe: (opts: { applicationServerKey: Uint8Array<ArrayBuffer> }) => {
      issued += 1;
      const endpoint = `https://push.example.com/endpoint-${String(issued)}`;
      const sub: FakeSubscription = {
        endpoint,
        options: { applicationServerKey: opts.applicationServerKey.buffer },
        toJSON: () => ({
          endpoint,
          keys: { p256dh: `p256dh-${endpoint}`, auth: `auth-${endpoint}` },
        }),
        unsubscribe: () => {
          if (manager.current?.endpoint === endpoint) manager.current = null;
          return Promise.resolve(true);
        },
      };
      manager.current = sub;
      return Promise.resolve(sub);
    },
  };
  return manager;
}

function createCacheStorage() {
  const stores = new Map<string, Map<string, Response>>();
  return {
    stores,
    open: (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return Promise.resolve({
        put: (key: string, value: Response) => {
          store.set(key, value);
          return Promise.resolve();
        },
        match: (key: string) => Promise.resolve(store.get(key)),
        delete: (key: string) => Promise.resolve(store.delete(key)),
      });
    },
    delete: (name: string) => Promise.resolve(stores.delete(name)),
  };
}

function createLocalStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  };
}

let pushManager: ReturnType<typeof createPushManager>;
let cacheStorage: ReturnType<typeof createCacheStorage>;
let localStorageStub: ReturnType<typeof createLocalStorage>;

const PUSH_CONFIG_CACHE = "push-config-v1";
const LAST_USER_KEY = "matchday-last-user-id";

beforeEach(() => {
  backend.rows.clear();
  backend.currentUserId = null;
  backend.online = true;
  backend.calls.length = 0;
  authSignOut.mockClear();

  pushManager = createPushManager();
  cacheStorage = createCacheStorage();
  localStorageStub = createLocalStorage();

  vi.stubGlobal("navigator", {
    serviceWorker: { ready: Promise.resolve({ pushManager }) },
    userAgent: "vitest",
  });
  vi.stubGlobal("window", {
    atob: globalThis.atob.bind(globalThis),
    btoa: globalThis.btoa.bind(globalThis),
    // detectSupport only probes for the key, never constructs it.
    PushManager: () => undefined,
    Notification: { permission: "granted" },
  });
  vi.stubGlobal("Notification", {
    permission: "granted",
    requestPermission: () => Promise.resolve("granted"),
  });
  vi.stubGlobal("caches", cacheStorage);
  vi.stubGlobal("localStorage", localStorageStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/**
 * Imported lazily so each test picks up the freshly stubbed globals
 * (auth-client builds its client at module load).
 */
async function loadModules() {
  const push = await import("./push.js");
  const auth = await import("./auth-client.js");
  return { ...push, ...auth };
}

async function signInAndEnablePush(userId: string): Promise<string> {
  backend.currentUserId = userId;
  const { enablePushOnThisDevice } = await loadModules();
  const { endpoint } = await enablePushOnThisDevice();
  return endpoint;
}

describe("push subscriptions on a shared device", () => {
  it("registers the endpoint against the signed-in account", async () => {
    const endpoint = await signInAndEnablePush("user-a");

    expect(backend.rows.get(endpoint)?.userId).toBe("user-a");
    expect(pushManager.current?.endpoint).toBe(endpoint);
    // The SW config has to be stashed for pushsubscriptionchange (#444).
    expect(cacheStorage.stores.has(PUSH_CONFIG_CACHE)).toBe(true);

    const { readPushState } = await loadModules();
    await expect(readPushState()).resolves.toMatchObject({ subscribed: true });
  });

  it("drops the subscription on explicit sign-out, before the session dies", async () => {
    const endpoint = await signInAndEnablePush("user-a");
    const { signOut } = await loadModules();

    await signOut();

    // Server row gone: the DELETE has to happen while the departing
    // user is still authenticated, so it must precede signOut().
    expect(backend.rows.has(endpoint)).toBe(false);
    expect(backend.calls).toEqual([
      "GET /api/push/public-key",
      "POST /api/me/push-subscriptions",
      "DELETE /api/me/push-subscriptions",
      "auth signOut",
    ]);
    // Local subscription gone, and the stashed config with it - without
    // that, pushsubscriptionchange would re-subscribe and re-register.
    expect(pushManager.current).toBeNull();
    expect(cacheStorage.stores.has(PUSH_CONFIG_CACHE)).toBe(false);
    expect(localStorageStub.entries.has(LAST_USER_KEY)).toBe(false);
  });

  it("reads as unsubscribed for the next user who signs in", async () => {
    await signInAndEnablePush("user-a");
    const { signOut, ensureCachesMatchUser, readPushState } =
      await loadModules();
    await signOut();

    backend.currentUserId = "user-b";
    await expect(ensureCachesMatchUser("user-b")).resolves.toBe(true);

    await expect(readPushState()).resolves.toMatchObject({
      subscribed: false,
    });
    expect(pushManager.current).toBeNull();
  });

  it("completes sign-out even when push teardown fails", async () => {
    await signInAndEnablePush("user-a");
    const { signOut } = await loadModules();
    // Service worker never settles (dev build / SW disabled): the
    // teardown must not wedge the sign-out button.
    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: new Promise(() => {
          /* never resolves */
        }),
      },
      userAgent: "vitest",
    });

    vi.useFakeTimers();
    try {
      const pending = signOut();
      // Burn the teardown timeout rather than the wall clock.
      await vi.advanceTimersByTimeAsync(5_000);
      await pending;
    } finally {
      vi.useRealTimers();
    }

    expect(authSignOut).toHaveBeenCalledTimes(1);
    expect(localStorageStub.entries.has(LAST_USER_KEY)).toBe(false);
  });

  it("drops a subscription left behind when the account switches without a sign-out", async () => {
    const endpoint = await signInAndEnablePush("user-a");
    const { ensureCachesMatchUser, readPushState } = await loadModules();
    localStorageStub.setItem(LAST_USER_KEY, "user-a");

    // A's cookie is replaced by B's without matchday's signOut() ever
    // running (signed in elsewhere, session swapped, expiry + re-login).
    backend.currentUserId = "user-b";
    await ensureCachesMatchUser("user-b");

    // Reconciliation is fired without awaiting so it can't block the
    // render gate on a network call.
    await vi.waitFor(() => {
      expect(pushManager.current).toBeNull();
    });

    // B never inherits A's alerts, and B's push reads as off.
    await expect(readPushState()).resolves.toMatchObject({
      subscribed: false,
    });
    // A's row can't be deleted while authenticated as B - it is pruned
    // by deletePushSubscriptionByEndpoint on the first 404/410 from the
    // push service, now that the endpoint is unsubscribed.
    expect(backend.rows.get(endpoint)?.userId).toBe("user-a");
  });

  it("keeps the subscription when the same user signs back in", async () => {
    const endpoint = await signInAndEnablePush("user-a");
    const { ensureCachesMatchUser } = await loadModules();
    // Safari evicted localStorage, so the last-user hint is gone: the
    // mismatch branch fires for a user whose subscription is genuinely
    // theirs. Server ownership is what decides, so it survives.
    localStorageStub.removeItem(LAST_USER_KEY);

    await ensureCachesMatchUser("user-a");
    await vi.waitFor(() => {
      expect(backend.calls).toContain("GET /api/me/push-subscriptions");
    });

    expect(pushManager.current?.endpoint).toBe(endpoint);
    expect(cacheStorage.stores.has(PUSH_CONFIG_CACHE)).toBe(true);
  });

  it("leaves the subscription alone when the session simply ends", async () => {
    await signInAndEnablePush("user-a");
    const { ensureCachesMatchUser } = await loadModules();
    localStorageStub.setItem(LAST_USER_KEY, "user-a");
    backend.calls.length = 0;

    // Cookie expired on a personal device. Dropping here would silently
    // turn push off for the person about to sign back in; a genuine
    // account switch is caught when the *next* user signs in instead.
    backend.currentUserId = null;
    await ensureCachesMatchUser(null);

    expect(pushManager.current).not.toBeNull();
    expect(backend.calls).toEqual([]);
  });

  it("drops the subscription when an account switch can't be verified offline", async () => {
    await signInAndEnablePush("user-a");
    const { ensureCachesMatchUser } = await loadModules();
    localStorageStub.setItem(LAST_USER_KEY, "user-a");

    // No way to ask who owns the endpoint, and no second chance: once
    // the last-user key is rewritten this boot, later boots see no
    // mismatch and never reconcile again. Dropping is the safe
    // direction, at the cost of a re-enable tap if the device was
    // actually still user A's.
    backend.currentUserId = "user-b";
    backend.online = false;
    await ensureCachesMatchUser("user-b");

    await vi.waitFor(() => {
      expect(pushManager.current).toBeNull();
    });
  });

  it("reports unsubscribed when ownership cannot be verified offline", async () => {
    await signInAndEnablePush("user-a");
    const { readPushState } = await loadModules();

    backend.online = false;

    // Safe direction: an unverifiable subscription must not render as
    // "this device will receive matchday push" - Enable re-registers
    // the existing browser subscription once the network is back.
    await expect(readPushState()).resolves.toMatchObject({
      subscribed: false,
    });
    expect(pushManager.current).not.toBeNull();
  });

  it("re-keys the endpoint to whoever explicitly enables push next", async () => {
    const first = await signInAndEnablePush("user-a");
    const { signOut } = await loadModules();
    await signOut();

    const second = await signInAndEnablePush("user-b");

    expect(backend.rows.get(second)?.userId).toBe("user-b");
    expect(backend.rows.has(first)).toBe(false);
  });
});
