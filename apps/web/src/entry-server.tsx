import {
  dehydrate,
  QueryClientProvider,
  type DehydratedState,
  type QueryClient,
} from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from "react-router";
import { ThemeProvider } from "./hooks/use-theme.js";
import { routes } from "./routes.js";

// Prerenderer entry (Node, not the browser): renders the real app -
// RootLayout, SiteHeader, ContentBody et al - to markup for the
// publish-time snapshot pipeline. Deliberately does NOT import main.tsx:
// its module side effects (New Relic browser agent, consent/attribution
// capture, app.css) are browser-only.
//
// The URL origin only anchors relative parsing - rendered links are
// relative, so any host works.
const RENDER_ORIGIN = "https://www.percymain.org";

// Module-level: the handler resolves each route's lazy module once and
// caches it on the route table, so a warm Lambda renders subsequent
// documents without re-importing modules.
const handler = createStaticHandler(routes);

export interface RenderResult {
  appHtml: string;
  dehydratedState: DehydratedState;
}

/**
 * Render `url` (path + optional search) with `queryClient` already
 * seeded (the caller fetchQuery's nav/detail data first - anything not
 * seeded renders its pending state, exactly as the SPA would).
 */
export async function render(
  url: string,
  queryClient: QueryClient,
): Promise<RenderResult> {
  const context = await handler.query(new Request(new URL(url, RENDER_ORIGIN)));

  // Without loaders/actions the handler never short-circuits to a
  // redirect/error Response; if one ever appears, fail the render loudly
  // rather than snapshotting an empty document.
  if (context instanceof Response) {
    throw new Error(
      `Static handler returned a Response (${String(context.status)}) for ${url}`,
    );
  }

  const router = createStaticRouter(handler.dataRoutes, context);

  const appHtml = renderToString(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <StaticRouterProvider
          router={router}
          context={context}
          hydrate={false}
        />
      </QueryClientProvider>
    </ThemeProvider>,
  );

  return { appHtml, dehydratedState: dehydrate(queryClient) };
}
