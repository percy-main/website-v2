import { useLocation, Link } from "react-router";
import {
  contentPageMap,
  getNavigationTree,
  getBreadcrumbs,
  type ContentNode,
} from "@/lib/content.js";
import { mdxComponents } from "@/components/mdx-components.js";
import { MDXProvider } from "@mdx-js/react";
import { IoChevronForward } from "react-icons/io5";
import { useState } from "react";

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
          <div key={child.page.path}>
            <Link
              to={child.page.path}
              className={
                isActive
                  ? "ml-[-0.76rem] border-l-4 border-primary py-1 pl-2 font-medium text-primary"
                  : "py-1 text-gray-700 hover:text-primary"
              }
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
                      className={
                        isChildActive
                          ? "ml-[-1.76rem] border-l-4 border-primary py-1 pl-6 font-medium text-primary"
                          : "py-1 text-gray-600 hover:text-primary"
                      }
                    >
                      {grandchild.page.title}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
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
                className={`border-b border-gray-100 px-4 py-2.5 font-medium transition-colors last:border-b-0 block ${
                  isActive
                    ? "bg-primary/5 text-primary"
                    : "text-gray-800 hover:bg-gray-50 hover:text-primary"
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
                    className={`border-b border-gray-100 py-2.5 pl-9 pr-4 transition-colors last:border-b-0 block ${
                      isChildActive
                        ? "bg-primary/5 font-medium text-primary"
                        : "text-gray-600 hover:bg-gray-50 hover:text-primary"
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
            className="flex cursor-pointer items-center p-1 text-dark md:hidden"
            aria-label="Toggle section menu"
          >
            <svg className="h-5 w-5 fill-current" viewBox="0 0 20 20">
              <path d="M0 3h20v2H0V3zm0 6h20v2H0V9zm0 6h20v2H0v-2z" />
            </svg>
          </button>
        )}
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-2">
            {i > 0 && (
              <IoChevronForward className="text-gray-400" size={14} />
            )}
            {i === breadcrumbs.length - 1 ? (
              <span className="text-dark font-medium">{crumb.title}</span>
            ) : (
              <Link to={crumb.path} className="text-gray-600 hover:text-primary">
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
            <nav className="space-y-2 text-sm">
              <div className="flex flex-col">
                <SidebarNav tree={navTree} currentPath={path} />
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
