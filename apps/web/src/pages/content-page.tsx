import { mdxComponents } from "@/components/mdx-components.js";
import {
  contentPageMap,
  getBreadcrumbs,
  getNavigationTree,
  type ContentNode,
} from "@/lib/content.js";
import { MDXProvider } from "@mdx-js/react";
import { Fragment, useState } from "react";
import { IoChevronForward } from "react-icons/io5";
import { Link, useLocation } from "react-router";

function SidebarNav({
  tree,
  currentPath,
}: {
  tree: ContentNode;
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
                  : "hover:text-primary text-gray-700"
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
                          : "hover:text-primary text-gray-600"
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
  tree: ContentNode;
  currentPath: string;
  isOpen: boolean;
}) {
  if (!isOpen) return null;

  return (
    <nav className="text-sm md:hidden">
      <div className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-md">
        {tree.children.map((child) => {
          const isActive = currentPath.startsWith(child.page.path);
          return (
            <div key={child.page.path}>
              <Link
                to={child.page.path}
                className={`block border-b border-gray-100 px-4 py-2.5 font-medium transition-colors last:border-b-0 ${
                  isActive
                    ? "bg-primary/5 text-primary"
                    : "hover:text-primary text-gray-800 hover:bg-gray-50"
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
                    className={`block border-b border-gray-100 py-2.5 pr-4 pl-9 transition-colors last:border-b-0 ${
                      isChildActive
                        ? "bg-primary/5 text-primary font-medium"
                        : "hover:text-primary text-gray-600 hover:bg-gray-50"
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

export function Component() {
  const { pathname } = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Normalize: strip trailing slash
  const path = pathname === "/" ? "/" : pathname.replace(/\/$/, "");

  const page = contentPageMap.get(path);

  if (!page) {
    return (
      <div className="container mx-auto px-4 py-12">
        <h1>Page Not Found</h1>
        <p>The page you're looking for doesn't exist.</p>
      </div>
    );
  }

  const navTree = getNavigationTree(path);
  const breadcrumbs = getBreadcrumbs(path);
  const hasSidebar = navTree && navTree.children.length > 0;
  const PageContent = page.Component;

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
            <svg className="h-5 w-5 fill-current" viewBox="0 0 20 20">
              <path d="M0 3h20v2H0V3zm0 6h20v2H0V9zm0 6h20v2H0v-2z" />
            </svg>
          </button>
        )}
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-2">
            {i > 0 && <IoChevronForward className="text-gray-400" size={14} />}
            {i === breadcrumbs.length - 1 ? (
              <span className="text-dark font-medium">{crumb.title}</span>
            ) : (
              <Link
                to={crumb.path}
                className="hover:text-primary text-gray-600"
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
        <div className="flex min-w-0 grow flex-col">
          <MDXProvider components={mdxComponents}>
            <div className="mdx-content flex flex-col *:mb-4">
              <PageContent />
            </div>
          </MDXProvider>
        </div>
      </div>
    </div>
  );
}
