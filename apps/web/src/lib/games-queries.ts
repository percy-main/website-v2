import { queryOptions } from "@tanstack/react-query";
import { api, callApi } from "./api-client.js";

// Shared query definitions for Play Cricket games, mirroring
// content-queries.ts. The prerenderer Lambda seeds snapshots through
// these exact options, so the dehydrated cache entry lands under the key
// the page components read - keeping them in one module stops the two
// sides drifting apart. Query keys predate this module and are pinned:
// other inline consumers (home.tsx, content-editor.tsx) still build
// ["games", season] / ["game", id] by hand.

const STALE_TIME = 5 * 60 * 1000;

export function gamesListQueryOptions(season: number) {
  return queryOptions({
    queryKey: ["games", season],
    queryFn: () =>
      callApi(api.GET("/api/games", { params: { query: { season } } })),
    staleTime: STALE_TIME,
  });
}

export function gameQueryOptions(matchId: string) {
  return queryOptions({
    queryKey: ["game", matchId],
    // No 404-to-null mapping: the page renders its not-found state off
    // the query error (`!game`), unlike the content detail queries.
    queryFn: () =>
      callApi(
        api.GET("/api/games/{matchId}", {
          params: { path: { matchId } },
        }),
      ),
    staleTime: STALE_TIME,
  });
}

export function gameReportQueryOptions(playCricketId: string) {
  return queryOptions({
    queryKey: ["content", "game-report", playCricketId],
    queryFn: async () => {
      try {
        return await callApi(
          api.GET(
            "/api/content/game-report/by-play-cricket-id/{playCricketId}",
            {
              params: { path: { playCricketId } },
            },
          ),
        );
      } catch (err) {
        // No published report for this game.
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
    // Scheduled publishing boundary: a null result can flip to published
    // the instant its published_at passes, so misses go stale fast while
    // a real report keeps the full 5 minutes.
    staleTime: (query) => (query.state.data === null ? 30 * 1000 : STALE_TIME),
    retry: false,
  });
}
