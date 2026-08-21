import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression cover for #628: user A opens their fantasy squad, logs out,
 * user B logs in on the same page-lifetime QueryClient. B must never see
 * (nor be able to save) A's squad.
 */

const session: { current: { user: { id: string } } | null } = { current: null };
vi.mock("@/lib/auth-client.js", () => ({
  useSession: () => ({ data: session.current, isPending: false }),
  authClient: {},
}));

import { authedQueryKey } from "@/lib/authed-query.js";
import { resetAuthCaches } from "@/lib/query-client.js";
import { Component as MembersFantasy } from "./members-fantasy.js";

// The free-agent pool is deliberately disjoint from either squad, so a
// squad name appearing in the markup can only have come from that user's
// own cached team.
const ELIGIBLE_PLAYERS = {
  players: [
    {
      play_cricket_id: "free-1",
      player_name: "Charlie Carr",
      sandwich_cost: 1,
      previousSeasonPoints: 10,
      ownershipPercent: 5,
    },
  ],
};

/** Prime the cache exactly as a completed page load for `userId` would. */
function seedFantasyCache(
  client: QueryClient,
  userId: string,
  captain: { id: string; name: string },
) {
  client.setQueryData(
    authedQueryKey(userId, ["fantasy", "eligible-players"]),
    ELIGIBLE_PLAYERS,
  );
  client.setQueryData(authedQueryKey(userId, ["fantasy", "my-team"]), {
    team: { id: 1, user_id: userId, season: "2026", created_at: "" },
    players: [
      {
        play_cricket_id: captain.id,
        player_name: captain.name,
        sandwich_cost: 1,
        is_captain: true,
        slot_type: "batting",
        is_wicketkeeper: true,
      },
    ],
    gameweek: 1,
    transfersUsed: 0,
    maxTransfers: null,
    chaosWeek: null,
  });
  client.setQueryData(authedQueryKey(userId, ["fantasy", "chip-status"]), {
    chips: [],
    gameweek: 1,
  });
}

const ALICE = { id: "a1", name: "Alice Alpha" };
const BOB = { id: "b1", name: "Bob Beta" };

function renderFantasyPage(client: QueryClient) {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MembersFantasy />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  session.current = null;
});

describe("members fantasy across an account switch", () => {
  it("renders the signed-in user's own squad", () => {
    const client = new QueryClient();
    seedFantasyCache(client, "user-a", ALICE);
    session.current = { user: { id: "user-a" } };

    const html = renderFantasyPage(client);

    expect(html).toContain("Alice Alpha");
  });

  it("shows user B a loading page, not user A's squad, after logout", async () => {
    const client = new QueryClient();
    seedFantasyCache(client, "user-a", ALICE);
    session.current = { user: { id: "user-a" } };
    expect(renderFantasyPage(client)).toContain("Alice Alpha");

    // Logout: the page calls resetAuthCaches once signOut settles.
    await resetAuthCaches(client);
    expect(client.getQueryCache().getAll()).toHaveLength(0);

    // Login as B.
    session.current = { user: { id: "user-b" } };
    const html = renderFantasyPage(client);

    expect(html).not.toContain("Alice Alpha");
    // Nothing cached for B yet, so the page sits in its loading state while
    // the three queries refetch - under B's key, with A's entries gone.
    expect(html).toContain("animate-pulse");
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    ).toEqual([
      authedQueryKey("user-b", ["fantasy", "eligible-players"]),
      authedQueryKey("user-b", ["fantasy", "my-team"]),
      authedQueryKey("user-b", ["fantasy", "chip-status"]),
    ]);
  });

  it("keeps the accounts apart even if a login path skips the reset", () => {
    // Belt and braces: the user-scoped key alone has to close the leak, so a
    // future login path that forgets resetAuthCaches cannot reopen it. A's
    // squad is still in the cache and B has fetched nothing.
    const client = new QueryClient();
    seedFantasyCache(client, "user-a", ALICE);

    session.current = { user: { id: "user-b" } };
    const html = renderFantasyPage(client);

    expect(html).not.toContain("Alice Alpha");
    expect(html).toContain("animate-pulse");
  });

  it("serves each account its own squad from the shared cache", () => {
    const client = new QueryClient();
    seedFantasyCache(client, "user-a", ALICE);
    seedFantasyCache(client, "user-b", BOB);

    session.current = { user: { id: "user-b" } };
    const asBob = renderFantasyPage(client);
    session.current = { user: { id: "user-a" } };
    const asAlice = renderFantasyPage(client);

    expect(asBob).toContain("Bob Beta");
    expect(asBob).not.toContain("Alice Alpha");
    expect(asAlice).toContain("Alice Alpha");
    expect(asAlice).not.toContain("Bob Beta");
  });
});
