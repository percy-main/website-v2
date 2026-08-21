import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The real auth client builds a better-auth instance at import time; the
// hooks under test only need a session shape.
const session: { current: { user: { id: string } } | null } = { current: null };
vi.mock("@/lib/auth-client.js", () => ({
  useSession: () => ({ data: session.current, isPending: false }),
}));

import {
  ANONYMOUS_USER_KEY,
  AUTHED_KEY_NAMESPACE,
  authedQueryKey,
  useAuthedQuery,
  useAuthedQueryKey,
} from "./authed-query.js";

function render(node: React.ReactNode, client: QueryClient) {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

beforeEach(() => {
  session.current = null;
});

describe("authedQueryKey", () => {
  it("fronts the logical key with the namespace and the owning user", () => {
    expect(authedQueryKey("user-a", ["fantasy", "my-team"])).toEqual([
      AUTHED_KEY_NAMESPACE,
      "user-a",
      "fantasy",
      "my-team",
    ]);
  });

  it("gives two accounts different keys for the same logical query", () => {
    expect(authedQueryKey("user-a", ["fantasy", "my-team"])).not.toEqual(
      authedQueryKey("user-b", ["fantasy", "my-team"]),
    );
  });
});

describe("useAuthedQueryKey", () => {
  // Rendered as a slash-joined string: renderToStaticMarkup escapes the
  // quotes JSON.stringify would produce.
  function Probe() {
    const authedKey = useAuthedQueryKey();
    return <span>{(authedKey(["myCharges"]) as string[]).join("/")}</span>;
  }

  it("builds keys for the signed-in user", () => {
    session.current = { user: { id: "user-b" } };

    const html = render(<Probe />, new QueryClient());

    expect(html).toContain(`${AUTHED_KEY_NAMESPACE}/user-b/myCharges`);
  });

  it("falls back to the anonymous bucket with no session", () => {
    const html = render(<Probe />, new QueryClient());

    expect(html).toContain(
      `${AUTHED_KEY_NAMESPACE}/${ANONYMOUS_USER_KEY}/myCharges`,
    );
  });
});

describe("useAuthedQuery", () => {
  function Squad() {
    const { data } = useAuthedQuery({
      queryKey: ["fantasy", "my-team"],
      queryFn: () => Promise.resolve({ captain: "unfetched" }),
    });
    return <span>{data?.captain ?? "no data"}</span>;
  }

  it("registers the query under the user-prefixed key", () => {
    session.current = { user: { id: "user-a" } };
    const client = new QueryClient();

    render(<Squad />, client);

    expect(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    ).toEqual([[AUTHED_KEY_NAMESPACE, "user-a", "fantasy", "my-team"]]);
  });

  it("does not read another account's entry for the same logical key", () => {
    // The leak in #628: one page-lifetime cache holding both accounts.
    const client = new QueryClient();
    client.setQueryData(authedQueryKey("user-a", ["fantasy", "my-team"]), {
      captain: "Alice Alpha",
    });
    client.setQueryData(authedQueryKey("user-b", ["fantasy", "my-team"]), {
      captain: "Bob Beta",
    });

    session.current = { user: { id: "user-b" } };
    const html = render(<Squad />, client);

    expect(html).toContain("Bob Beta");
    expect(html).not.toContain("Alice Alpha");
  });
});
