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

export function hasWagonWheel(data: WagonWheelData | undefined): boolean {
  // Require at least one ball with a recorded shot direction — otherwise
  // the viewer would open onto an empty wheel even though the API
  // technically returned ball-by-ball rows.
  return (
    !!data &&
    data.innings.some((inn) => inn.balls.some((b) => b.shotAngle !== null))
  );
}
