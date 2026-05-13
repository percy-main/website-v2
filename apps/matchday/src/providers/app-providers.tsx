import { ThemeProvider } from "@/hooks/use-theme.js";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

function logQueryError(
  err: unknown,
  attrs: Record<string, string | number | boolean>,
) {
  const error = err instanceof Error ? err : new Error(String(err));
  // No New Relic in matchday yet — log to console; phase 5 / observability
  // pass can wire NR Browser the same way apps/web does.
  console.error("matchday react-query error:", error.message, attrs);
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (err, query) =>
            logQueryError(err, {
              kind: "query",
              queryKey: query.queryKey
                .flatMap((part) => (typeof part === "string" ? [part] : []))
                .join(":"),
            }),
        }),
        mutationCache: new MutationCache({
          onError: (err, _vars, _ctx, mutation) =>
            logQueryError(err, {
              kind: "mutation",
              mutationKey:
                mutation.options.mutationKey
                  ?.flatMap((part) => (typeof part === "string" ? [part] : []))
                  .join(":") ?? "unknown",
            }),
        }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Pitch-side networks drop in and out; let react-query retry.
            retry: 1,
          },
        },
      }),
  );
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
