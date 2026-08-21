import { useSession } from "@/lib/auth-client.js";
import { detectSupport, readPushState, type PushState } from "@/lib/push.js";
import { useQuery } from "@tanstack/react-query";

export const PUSH_STATE_QUERY_KEY = ["me", "push-state"] as const;

export function usePushState(): {
  state: PushState;
  refresh: () => Promise<unknown>;
} {
  const { data: session } = useSession();
  const userId = session?.user.id ?? null;

  const query = useQuery({
    // Keyed by user: push state is now partly server state (is this
    // browser's endpoint registered to *this* account?), so a cached
    // answer must never be reused across an account switch.
    queryKey: [...PUSH_STATE_QUERY_KEY, userId],
    queryFn: readPushState,
    // Only enable/disable from this screen change it, and both refetch
    // explicitly via `refresh`.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const state: PushState = query.data ?? {
    // Support is a synchronous capability check, so surface it on first
    // paint - only `subscribed` waits on the query.
    support: detectSupport(),
    subscribed: null,
  };

  return { state, refresh: () => query.refetch() };
}
