import { ThemeProvider } from "@/hooks/use-theme.js";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * Forward any react-query (or react-query-mutation) error to NR
 * Browser. Without this, react-query failures bubble to component-
 * local `error` state and never reach NR — a server 5xx on a query
 * shows as a toast (or nothing) and is invisible to observability.
 */
function noticeQueryError(
  err: unknown,
  attrs: Record<string, string | number | boolean>,
) {
  const error = err instanceof Error ? err : new Error(String(err));
  if (window.newrelic) {
    window.newrelic.noticeError(error, attrs);
  } else {
    console.error("react-query (NR not loaded):", error.message, attrs);
  }
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (err, query) =>
            noticeQueryError(err, {
              kind: "query",
              queryKey: query.queryKey
                .flatMap((part) => (typeof part === "string" ? [part] : []))
                .join(":"),
            }),
        }),
        mutationCache: new MutationCache({
          onError: (err, _vars, _ctx, mutation) =>
            noticeQueryError(err, {
              kind: "mutation",
              mutationKey:
                mutation.options.mutationKey
                  ?.flatMap((part) => (typeof part === "string" ? [part] : []))
                  .join(":") ?? "unknown",
            }),
        }),
      }),
  );
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
