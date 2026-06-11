import { ContentBody } from "@/components/content-body.js";
import { mdxComponents } from "@/components/mdx-components.js";
import { PageLoading } from "@/components/page-loading.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { useSiteNav } from "@/hooks/use-site-nav.js";
import type { paths } from "@/lib/api.gen.js";
import {
  pageByPathQueryOptions,
  parsePageMetadata,
} from "@/lib/content-queries.js";
import { contentPageMap, type ContentPage } from "@/lib/content.js";
import {
  getBreadcrumbs,
  getNavigationTree,
  type NavNode,
  type NavPage,
} from "@/lib/nav.js";
import { MDXProvider } from "@mdx-js/react";
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
            <Link
              to={child.page.path}
              className={`py-1 ${
                isActive
                  ? "border-primary text-primary ml-[-0.76rem] border-l-4 pl-2 font-medium"
                  : "hover:text-primary text-stone-700"
              }`}
            >
              {child.page.title}
            </Link>
            {child.children.length > 0 && (
              <div className="ml-4 flex flex-col">
                {child.children.map((grandchild) => {
                  const isChildActive =
                    currentPath === grandchild.page.path ||
                    currentPath.startsWith(grandchild.page.path + "/");
                  return (
                    <Link
                      key={grandchild.page.path}
                      to={grandchild.page.path}
                      className={`py-1 ${
                        isChildActive
                          ? "border-primary text-primary ml-[-1.76rem] border-l-4 pl-4 font-medium"
                          : "hover:text-primary text-stone-600"
                      }`}
                    >
                      <span className={isChildActive ? "pl-2" : ""}>
                        {grandchild.page.title}
                      </span>
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
      <div className="flex flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-md">
        {tree.children.map((child) => {
          const isActive = currentPath.startsWith(child.page.path);
          return (
            <div key={child.page.path}>
              <Link
                to={child.page.path}
                className={`block border-b border-stone-100 px-4 py-2.5 font-medium transition-colors last:border-b-0 ${
                  isActive
                    ? "bg-primary/5 text-primary"
                    : "hover:text-primary text-stone-800 hover:bg-stone-50"
                }`}
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
                    className={`block border-b border-stone-100 py-2.5 pr-4 pl-9 transition-colors last:border-b-0 ${
                      isChildActive
                        ? "bg-primary/5 text-primary font-medium"
                        : "hover:text-primary text-stone-600 hover:bg-stone-50"
                    }`}
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
      {/* Breadcrumbs */}
      <div className="text-h4 mb-4 flex items-center gap-2">
        {hasSidebar && (
          <button
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            className="text-dark flex cursor-pointer items-center p-1 md:hidden"
            aria-label="Toggle section menu"
          >
            <svg className="size-5 fill-current" viewBox="0 0 20 20">
              <path d="M0 3h20v2H0V3zm0 6h20v2H0V9zm0 6h20v2H0v-2z" />
            </svg>
          </button>
        )}
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-2">
            {i > 0 && <IoChevronForward className="text-stone-400" size={14} />}
            {i === breadcrumbs.length - 1 ? (
              <span className="text-dark font-medium">{crumb.title}</span>
            ) : (
              <Link
                to={crumb.path}
                className="hover:text-primary text-stone-600"
              >
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
      {!meta?.hideTitle && <h2 className="mb-4">{page.title}</h2>}
      <ContentBody body={page.body} />
    </PageChrome>
  );
}

/** Bundled MDX page - the static pipeline rendering. */
function StaticPageView({
  page,
  navPages,
  path,
}: {
  page: ContentPage;
  navPages: NavPage[];
  path: string;
}) {
  const PageContent = page.Component;

  return (
    <PageChrome navPages={navPages} path={path}>
      <MDXProvider components={mdxComponents}>
        <div className="mdx-content flex flex-col *:mb-4">
          {!page.hideTitle && <h2>{page.title}</h2>}
          <PageContent />
        </div>
      </MDXProvider>
    </PageChrome>
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

  // DB-backed page first (page hierarchy, #493). Unlike the news/events
  // TRANSITION FALLBACK (#489), the static MDX fallback here is
  // long-lived: pages migrate to the DB one section at a time and some
  // (e.g. legal) stay static permanently, so unmigrated paths keep
  // rendering their bundled MDX indefinitely. The MDX renders only once
  // the query settles (confirmed 404, or an API failure - deliberate
  // graceful degradation) so a DB-edited page never flashes its stale
  // MDX ancestor first.
  const { data: apiPage, isPending } = useQuery({
    ...pageByPathQueryOptions(path),
    enabled: isContentPath,
  });
  const staticPage = contentPageMap.get(path);

  // Sidebar + breadcrumbs come from the merged nav for both static and
  // DB-backed pages.
  const navPages = useSiteNav();

  useDocumentMeta(
    apiPage?.title ?? staticPage?.title,
    apiPage ? (apiPage.description ?? undefined) : staticPage?.description,
  );

  // 404s land here because router.tsx's catch-all `path: "*"` routes
  // unknown paths through ContentPage rather than triggering the
  // root errorElement (#182). Forward the miss to NR so the not-
  // found rate is observable. Only after the API query settles - a page
  // that is still loading is not a miss.
  const notFound = !apiPage && !staticPage && (!isContentPath || !isPending);
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

  if (staticPage) {
    return <StaticPageView page={staticPage} navPages={navPages} path={path} />;
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <h1>Page Not Found</h1>
      <p>The page you're looking for doesn't exist.</p>
    </div>
  );
}
