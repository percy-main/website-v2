import { ContentBody } from "@/components/content-body.js";
import { PageLoading } from "@/components/page-loading.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { useSiteNav } from "@/hooks/use-site-nav.js";
import type { paths } from "@/lib/api.gen.js";
import {
  isPageGone,
  pageByPathQueryOptions,
  parsePageMetadata,
} from "@/lib/content-queries.js";
import {
  getBreadcrumbs,
  getNavigationTree,
  type NavNode,
  type NavPage,
} from "@/lib/nav.js";
import { cn } from "@/lib/utils.js";
import { contentPathSchema } from "@percy-main/shared/content";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { IoChevronForward } from "react-icons/io5";
import { Link, useLocation } from "react-router";

type ApiPage =
  paths["/api/content/page/by-path"]["get"]["responses"]["200"]["content"]["application/json"];

function SidebarNav({
  tree,
  currentPath,
}: {
  tree: NavNode;
  currentPath: string;
}) {
  return (
    <>
      {tree.children.map((child) => {
        const isActive = currentPath.startsWith(child.page.path);
        return (
          <Fragment key={child.page.path}>
            {/* Top-level items read as printed section labels: condensed
                display face, uppercase, with an orange registration bar
                marking the active section. */}
            <Link
              to={child.page.path}
              className={cn(
                "font-secondary py-1.5 text-[15px] leading-tight tracking-wide uppercase transition-colors",
                isActive
                  ? "border-cta text-primary ml-[-0.85rem] border-l-4 pl-3"
                  : "text-primary/70 hover:text-cta",
              )}
            >
              {child.page.title}
            </Link>
            {child.children.length > 0 && (
              <div className="mt-1 mb-1 flex flex-col">
                {child.children.map((grandchild) => {
                  const isChildActive =
                    currentPath === grandchild.page.path ||
                    currentPath.startsWith(grandchild.page.path + "/");
                  // Each child carries its own left rule; the rules stack into
                  // one continuous hairline, and the active child inks it orange.
                  return (
                    <Link
                      key={grandchild.page.path}
                      to={grandchild.page.path}
                      className={cn(
                        "ml-1 border-l-2 py-1 pl-3 text-sm transition-colors",
                        isChildActive
                          ? "border-cta text-primary font-semibold"
                          : "border-border text-muted hover:text-cta",
                      )}
                    >
                      {grandchild.page.title}
                    </Link>
                  );
                })}
              </div>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function MobileSidebarNav({
  tree,
  currentPath,
  isOpen,
}: {
  tree: NavNode;
  currentPath: string;
  isOpen: boolean;
}) {
  if (!isOpen) return null;

  return (
    <nav className="text-sm md:hidden">
      <div className="border-primary bg-surface flex flex-col overflow-hidden border-2">
        {tree.children.map((child) => {
          const isActive = currentPath.startsWith(child.page.path);
          return (
            <div key={child.page.path}>
              <Link
                to={child.page.path}
                className={cn(
                  "font-secondary border-border block border-b px-4 py-2.5 tracking-wide uppercase transition-colors last:border-b-0",
                  isActive
                    ? "bg-cta/10 text-primary"
                    : "text-primary/80 hover:bg-cta/10 hover:text-cta",
                )}
              >
                {child.page.title}
              </Link>
              {child.children.map((grandchild) => {
                const isChildActive =
                  currentPath === grandchild.page.path ||
                  currentPath.startsWith(grandchild.page.path + "/");
                return (
                  <Link
                    key={grandchild.page.path}
                    to={grandchild.page.path}
                    className={cn(
                      "border-border block border-b py-2.5 pr-4 pl-9 transition-colors last:border-b-0",
                      isChildActive
                        ? "bg-cta/10 text-primary font-semibold"
                        : "text-muted hover:bg-cta/10 hover:text-cta",
                    )}
                  >
                    {grandchild.page.title}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Shared page chrome: breadcrumbs, mobile section nav and desktop sidebar
 * built from the merged nav (#493) - static and DB-backed pages get
 * identical navigation, so a section migrating to the DB never changes
 * how its unmigrated siblings appear.
 */
function PageChrome({
  navPages,
  path,
  children,
}: {
  navPages: NavPage[];
  path: string;
  children: ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navTree = getNavigationTree(navPages, path);
  const breadcrumbs = getBreadcrumbs(navPages, path);
  const hasSidebar = navTree && navTree.children.length > 0;

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Breadcrumbs: a compact letterspaced trail, the same kicker voice as
          the rest of the print system. */}
      <div className="mb-5 flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
        {hasSidebar && (
          <button
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            className="text-primary flex cursor-pointer items-center p-1 md:hidden"
            aria-label="Toggle section menu"
          >
            <svg className="size-5 fill-current" viewBox="0 0 20 20">
              <path d="M0 3h20v2H0V3zm0 6h20v2H0V9zm0 6h20v2H0v-2z" />
            </svg>
          </button>
        )}
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-2">
            {i > 0 && (
              <IoChevronForward className="text-primary/40" size={12} />
            )}
            {i === breadcrumbs.length - 1 ? (
              <span className="text-primary">{crumb.title}</span>
            ) : (
              <Link to={crumb.path} className="text-muted hover:text-cta">
                {crumb.title}
              </Link>
            )}
          </span>
        ))}
      </div>

      {/* Mobile nav */}
      {hasSidebar && (
        <MobileSidebarNav
          tree={navTree}
          currentPath={path}
          isOpen={mobileNavOpen}
        />
      )}

      {/* Main content area */}
      <div className={hasSidebar ? "flex flex-col gap-8 md:flex-row" : ""}>
        {/* Desktop sidebar */}
        {hasSidebar && (
          <aside className="hidden w-64 shrink-0 md:block">
            <nav className="hidden space-y-8 text-sm md:block">
              <div className="space-y-2">
                <div className="flex flex-col">
                  <SidebarNav tree={navTree} currentPath={path} />
                </div>
              </div>
            </nav>
          </aside>
        )}

        {/* Content */}
        <div className="flex min-w-0 grow flex-col">{children}</div>
      </div>
    </div>
  );
}

/** DB-backed page (page hierarchy, #493). */
function ApiPageView({
  page,
  navPages,
  path,
}: {
  page: ApiPage;
  navPages: NavPage[];
  path: string;
}) {
  const meta = parsePageMetadata(page.metadata);

  // metadata.ldjson is deliberately not rendered: the static pipeline
  // parses ldjson from frontmatter but nothing injects it into the
  // document (no page sets it today), so parity means carrying the field
  // without inventing a <script type="application/ld+json"> here.
  return (
    <PageChrome navPages={navPages} path={path}>
      {!meta?.hideTitle && <h2 className="fc-two-tone mb-4">{page.title}</h2>}
      <ContentBody body={page.body} />
    </PageChrome>
  );
}

function NotFoundView() {
  return (
    <div className="container mx-auto px-4 py-12">
      <h1>Page Not Found</h1>
      <p>The page you're looking for doesn't exist.</p>
    </div>
  );
}

/**
 * Non-404/410 API failure with no static fallback: the page may well
 * exist, we just couldn't fetch it - distinct copy from the 404 view so
 * visitors (and screenshots in bug reports) don't conflate an outage
 * with a missing page.
 */
function LoadErrorView() {
  return (
    <div className="container mx-auto px-4 py-12">
      <h1>We couldn't load this page</h1>
      <p>
        Something went wrong fetching this page. Please try again in a few
        minutes.
      </p>
    </div>
  );
}

export function Component() {
  const { pathname } = useLocation();

  // Normalize: strip trailing slash
  const path = pathname === "/" ? "/" : pathname.replace(/\/$/, "");

  // Only paths the backend could ever serve (lowercase /slug segments -
  // the shared contentPathSchema is the source of truth) hit the API;
  // anything else skips the query and behaves exactly as the static
  // pipeline always has.
  const isContentPath = contentPathSchema.safeParse(path).success;

  // DB-backed page (page hierarchy, #493). Three terminal query states:
  //   null      - never published in the DB: 404.
  //   PAGE_GONE - 410, deliberate takedown of an ever-live page: 404
  //               view with NO route_not_found report (nothing is
  //               missing).
  //   error     - API incident: a "couldn't load" view - never the 404
  //               copy, never a route_not_found report (an outage must
  //               not spike the not-found metric).
  const { data, isPending, isError } = useQuery({
    ...pageByPathQueryOptions(path),
    enabled: isContentPath,
  });
  const gone = isPageGone(data);
  const apiPage = data == null || isPageGone(data) ? undefined : data;

  const navPages = useSiteNav();

  useDocumentMeta(apiPage?.title, apiPage?.description ?? undefined);

  // 404s land here because router.tsx's catch-all `path: "*"` routes
  // unknown paths through ContentPage rather than triggering the
  // root errorElement (#182). Forward the miss to NR so the not-
  // found rate is observable. Only a settled, confirmed miss counts:
  // still-loading pages, 410 takedowns and API errors are not misses.
  const notFound =
    !gone && !isError && (!isContentPath || (!isPending && data === null));
  useEffect(() => {
    if (!notFound) return;
    if (window.newrelic) {
      window.newrelic.noticeError(new Error(`route_not_found ${path}`), {
        kind: "route_not_found",
        route: path,
      });
    } else {
      console.warn("route_not_found (NR not loaded):", path);
    }
  }, [notFound, path]);

  if (apiPage) {
    return <ApiPageView page={apiPage} navPages={navPages} path={path} />;
  }

  if (isContentPath && isPending) {
    return (
      <div className="container mx-auto px-4 py-6">
        <PageLoading />
      </div>
    );
  }

  if (isError) {
    return <LoadErrorView />;
  }

  return <NotFoundView />;
}
