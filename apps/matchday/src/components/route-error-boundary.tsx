import { Button } from "@/components/ui/button.js";
import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";

function isLikelyStaleChunk(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = `${error.name}: ${error.message}`.toLowerCase();
  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("loading chunk") ||
    message.includes("loading css chunk")
  );
}

/**
 * Catches anything thrown in a child route and shows a friendly screen
 * instead of React Router's developer-mode default. The most common
 * cause in production is a stale shell trying to import a chunk that
 * the new deploy no longer serves — for that case we surface a clear
 * "the app updated" message and a one-tap reload.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();
  const staleChunk = isLikelyStaleChunk(error);

  const status = isRouteErrorResponse(error) ? error.status : undefined;
  const title = staleChunk
    ? "Matchday just updated"
    : status === 404
      ? "Page not found"
      : "Something went wrong";
  const detail = staleChunk
    ? "We've got a newer version ready. Reload to pick it up."
    : status === 404
      ? "That page isn't here. Head back to the home screen."
      : "An unexpected error stopped the page from loading. Try again, or head home if the problem sticks around.";

  return (
    <div className="bg-surface-raised text-text flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <div className="bg-navy/10 text-navy mb-5 flex size-14 items-center justify-center rounded-full">
          <AlertTriangleIcon className="size-7" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-text-muted mt-2 text-sm leading-relaxed">{detail}</p>
        <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          <Button
            tone="primary"
            size="lg"
            onClick={() => window.location.reload()}
            className="w-full sm:w-auto"
          >
            <RefreshCwIcon />
            Reload
          </Button>
          {!staleChunk && (
            <Button
              tone="outline"
              size="lg"
              onClick={() => {
                void navigate("/", { replace: true });
              }}
              className="w-full sm:w-auto"
            >
              Go home
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
