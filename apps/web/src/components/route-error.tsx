import { useEffect } from "react";
import { isRouteErrorResponse, useLocation, useRouteError } from "react-router";

/**
 * Default errorElement for the route tree (#182). Catches:
 *   - Render-time exceptions in lazy routes (otherwise: white screen)
 *   - Loader/action throws (when those land — none today)
 *   - Route-not-found (404 fallthrough — react-router synthesises a
 *     Response that this component can render)
 *
 * On every render, fires window.newrelic.noticeError with the route
 * path + status so the failure is filterable in NR Browser. The agent's
 * automatic uncaught-exception capture would also see this, but
 * without the route attribute or the chance to render a useful UI.
 */
export function RouteError() {
  const error = useRouteError();
  const location = useLocation();

  useEffect(() => {
    const err =
      error instanceof Error
        ? error
        : new Error(
            typeof error === "object" && error
              ? JSON.stringify(error)
              : String(error),
          );
    if (window.newrelic) {
      window.newrelic.noticeError(err, {
        kind: "route_error",
        route: location.pathname,
        status: isRouteErrorResponse(error) ? error.status : 0,
      });
    } else {
      console.error("route_error (NR not loaded):", err.message, {
        route: location.pathname,
      });
    }
  }, [error, location.pathname]);

  if (isRouteErrorResponse(error)) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-2xl font-semibold text-stone-700">
          {error.status === 404 ? "Page not found" : `Error ${error.status}`}
        </h1>
        <p className="mt-2 text-sm text-stone-500">
          {error.status === 404
            ? "The page you were looking for doesn't exist."
            : "Something went wrong loading this page. We've been notified."}
        </p>
        <a
          href="/"
          className="mt-6 inline-block text-sm text-blue-600 underline"
        >
          Back to home
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-2xl font-semibold text-stone-700">
        Something went wrong
      </h1>
      <p className="mt-2 text-sm text-stone-500">
        We've been notified and will look into it. Try refreshing the page.
      </p>
      <a href="/" className="mt-6 inline-block text-sm text-blue-600 underline">
        Back to home
      </a>
    </div>
  );
}
