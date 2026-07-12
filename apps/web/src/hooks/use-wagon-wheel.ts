import { api, callApi } from "@/lib/api-client.js";
import type { paths } from "@/lib/api.gen.js";
import { useQuery } from "@tanstack/react-query";

export type WagonWheelData =
  paths["/api/games/{matchId}/wagon-wheel"]["get"]["responses"]["200"]["content"]["application/json"];

const STALE_TIME = 5 * 60 * 1000;

export function useWagonWheelQuery(matchId: string, enabled = true) {
  return useQuery({
    queryKey: ["wagon-wheel", matchId],
    queryFn: () =>
      callApi(
        api.GET("/api/games/{matchId}/wagon-wheel", {
          params: { path: { matchId } },
        }),
      ),
    enabled: !!matchId && enabled,
    staleTime: STALE_TIME,
  });
}

export function hasBallByBall(data: WagonWheelData | undefined): boolean {
  // Any recorded balls at all. Some matches are scored ball-by-ball without
  // shot directions — the viewer still has the worm chart, stats and
  // commentary to show, so shot angles must not gate it (the wheel itself
  // falls back to a "no shot data" panel per innings).
  return !!data && data.innings.some((inn) => inn.balls.length > 0);
}
