import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { resetAuthCaches } from "./query-client.js";

describe("resetAuthCaches", () => {
  it("cancels before clearing", async () => {
    const client = new QueryClient();
    const order: string[] = [];
    vi.spyOn(client, "cancelQueries").mockImplementation(() => {
      order.push("cancel");
      return Promise.resolve();
    });
    vi.spyOn(client, "clear").mockImplementation(() => {
      order.push("clear");
    });

    await resetAuthCaches(client);

    // Order is the whole point: clearing first would leave an in-flight
    // fetch free to write the old account's response into the fresh cache.
    expect(order).toEqual(["cancel", "clear"]);
  });

  it("empties the cache", async () => {
    const client = new QueryClient();
    client.setQueryData(["user-scoped", "user-a", "fantasy", "my-team"], {
      players: ["Alice"],
    });
    client.setQueryData(["content", "news-list"], { items: [] });

    await resetAuthCaches(client);

    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("does not let a fetch issued under the old identity land afterwards", async () => {
    const client = new QueryClient();
    const key = ["user-scoped", "user-a", "fantasy", "my-team"];
    let release: (value: { players: string[] }) => void = () => undefined;
    const inFlight = new Promise<{ players: string[] }>((resolve) => {
      release = resolve;
    });
    // Started under user A and still unresolved when the account changes.
    const fetching = client
      .fetchQuery({ queryKey: key, queryFn: () => inFlight })
      .catch(() => undefined);

    await resetAuthCaches(client);
    release({ players: ["Alice"] });
    await fetching;

    expect(client.getQueryData(key)).toBeUndefined();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});
