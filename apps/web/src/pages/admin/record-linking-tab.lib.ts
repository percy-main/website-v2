// ---------------------------------------------------------------------------
// Pure helpers extracted from record-linking-tab.tsx for unit testing.
// No React, no react-query, no DOM dependencies.
// ---------------------------------------------------------------------------

export interface PlayCricketPlayer {
  memberId: number;
  name: string;
}

export interface PersonRow {
  id: string;
  name: string | null;
  playCricketId: string | null;
  slug?: string | null;
  parentName?: string | null;
  type: "member" | "dependent";
}

/**
 * Lightweight similarity score in the range 0..1 used to suggest
 * Play-Cricket matches for an unlinked member.
 *
 * The thresholds are calibrated for human-readable names:
 *   1.0  exact (case-insensitive, trimmed) match
 *   0.8  query is a substring of target
 *   0.7  target is a substring of query
 *   ≤0.6 token-overlap based fallback
 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase().trim();

  if (q.length === 0 || t.length === 0) return 0;
  if (q === t) return 1;
  if (t.includes(q)) return 0.8;
  if (q.includes(t)) return 0.7;

  const queryTokens = q.split(/\s+/);
  const targetTokens = t.split(/\s+/);
  let matchedTokens = 0;

  for (const qt of queryTokens) {
    for (const tt of targetTokens) {
      if (tt.includes(qt) || qt.includes(tt)) {
        matchedTokens++;
        break;
      }
    }
  }

  let reverseMatchedTokens = 0;
  for (const tt of targetTokens) {
    for (const qt of queryTokens) {
      if (qt.includes(tt) || tt.includes(qt)) {
        reverseMatchedTokens++;
        break;
      }
    }
  }

  const forwardRatio = matchedTokens / queryTokens.length;
  const reverseRatio = reverseMatchedTokens / targetTokens.length;

  return Math.max(forwardRatio, reverseRatio) * 0.6;
}

/**
 * Display name for a person row in the table. Falls back to a placeholder
 * when no name is set (extremely rare for members; possible for dependents
 * with incomplete records).
 */
export function chooseDisplayName(person: PersonRow): string {
  const name = person.name?.trim();
  if (name && name.length > 0) return name;
  return person.type === "member" ? "(unnamed member)" : "(unnamed junior)";
}

export interface PersonStatsSummary {
  totalMembers: number;
  totalDependents: number;
  linkedPcMembers: number;
  linkedPcDeps: number;
  unlinkedPcMembers: number;
  unlinkedPcDeps: number;
}

/**
 * Aggregate counts shown in the header stats bar.
 */
export function summarisePersonStats(
  allPeople: ReadonlyArray<PersonRow>,
): PersonStatsSummary {
  let totalMembers = 0;
  let totalDependents = 0;
  let linkedPcMembers = 0;
  let linkedPcDeps = 0;

  for (const person of allPeople) {
    if (person.type === "member") {
      totalMembers++;
      if (person.playCricketId) linkedPcMembers++;
    } else {
      totalDependents++;
      if (person.playCricketId) linkedPcDeps++;
    }
  }

  return {
    totalMembers,
    totalDependents,
    linkedPcMembers,
    linkedPcDeps,
    unlinkedPcMembers: totalMembers - linkedPcMembers,
    unlinkedPcDeps: totalDependents - linkedPcDeps,
  };
}

export interface FilterPeopleParams {
  search: string;
  showLinked: boolean;
  showUnlinked: boolean;
  personTypeFilter: "all" | "member" | "dependent";
}

/**
 * Apply the filter bar's controls to the combined list of people.
 * Pure: takes the resolved (debounced) search term and returns a new array.
 */
export function filterPeople(
  allPeople: ReadonlyArray<PersonRow>,
  params: FilterPeopleParams,
): PersonRow[] {
  const { search, showLinked, showUnlinked, personTypeFilter } = params;
  const term = search.toLowerCase().trim();

  return allPeople.filter((person) => {
    if (personTypeFilter !== "all" && person.type !== personTypeFilter) {
      return false;
    }
    const isLinked = Boolean(person.playCricketId);
    if (!showLinked && isLinked) return false;
    if (!showUnlinked && !isLinked) return false;

    if (term.length > 0) {
      const nameMatch = person.name?.toLowerCase().includes(term) ?? false;
      const parentMatch =
        person.parentName?.toLowerCase().includes(term) ?? false;
      if (!nameMatch && !parentMatch) return false;
    }

    return true;
  });
}

export interface ScoredPlayCricketPlayer extends PlayCricketPlayer {
  score: number;
}

/**
 * Filter and rank Play-Cricket players for the link-suggestion list.
 * Mirrors the original useMemo body in DetailModal.
 */
export function rankPlayCricketSuggestions(
  pcPlayers: ReadonlyArray<PlayCricketPlayer>,
  personName: string | null,
  linkSearch: string,
): ScoredPlayCricketPlayer[] {
  const trimmedSearch = linkSearch.trim();
  const query = trimmedSearch.length > 0 ? linkSearch : (personName ?? "");
  const term = linkSearch.toLowerCase().trim();

  return pcPlayers
    .flatMap<ScoredPlayCricketPlayer>((player) => {
      const scored: ScoredPlayCricketPlayer = {
        ...player,
        score: fuzzyScore(query, player.name),
      };
      if (term.length > 0) {
        return scored.name.toLowerCase().includes(term) ||
          scored.memberId.toString().includes(term) ||
          scored.score > 0.3
          ? [scored]
          : [];
      }
      return scored.score > 0.2 ? [scored] : [];
    })
    .toSorted((a, b) => b.score - a.score)
    .slice(0, 20);
}

/**
 * Build a quick-lookup map from Play-Cricket member id (as string) to
 * player name, given the loaded list (or null if not yet loaded).
 */
export function buildPlayerNameMap(
  pcPlayers: ReadonlyArray<PlayCricketPlayer> | null,
): Map<string, string> {
  if (!pcPlayers) return new Map();
  return new Map(pcPlayers.map((p) => [p.memberId.toString(), p.name]));
}
