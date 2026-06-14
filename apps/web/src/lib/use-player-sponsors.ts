import { api, callApi } from "@/lib/api-client.js";
import type { paths } from "@/lib/api.gen.js";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

// One cached query backs every sponsored person card on the page - the
// whole season's approved sponsors ride a single request, so a page full
// of person cards costs one extra fetch, not one per card (same stance as
// usePeople's roster query).

/** An approved, paid player sponsor for the current season. */
export type PlayerSponsorSummary = NonNullable<
  paths["/api/sponsorship/player/approved"]["get"]["responses"][200]["content"]["application/json"]
>["sponsors"][number];

const STALE_TIME = 5 * 60 * 1000;

export function playerSponsorsQueryOptions() {
  return queryOptions({
    queryKey: ["sponsorship", "player-approved"],
    queryFn: () => callApi(api.GET("/api/sponsorship/player/approved")),
    staleTime: STALE_TIME,
  });
}

/**
 * Index approved sponsors by person slug. The DB enforces one paid
 * sponsorship per (slug, season), so a slug maps to at most one sponsor.
 * Rows without a slug (legacy/manual) are dropped - they can't be matched
 * to a person card. Pure and exported for tests; usePlayerSponsors feeds
 * it the live query data.
 */
export function buildPlayerSponsors(
  sponsors: PlayerSponsorSummary[] | undefined,
): Map<string, PlayerSponsorSummary> {
  const map = new Map<string, PlayerSponsorSummary>();
  for (const sponsor of sponsors ?? []) {
    if (sponsor.slug) map.set(sponsor.slug, sponsor);
  }
  return map;
}

/** Approved player sponsors keyed by person slug - see buildPlayerSponsors. */
export function usePlayerSponsors(): Map<string, PlayerSponsorSummary> {
  const { data } = useQuery(playerSponsorsQueryOptions());
  return useMemo(() => buildPlayerSponsors(data?.sponsors), [data]);
}
