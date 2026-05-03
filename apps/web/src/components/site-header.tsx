import { useSession } from "@/lib/auth-client.js";
import { getMainMenuItems } from "@/lib/content.js";
import { getPriceId } from "@/lib/stripe-env.js";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FC,
  type KeyboardEvent,
} from "react";
import { Link, useLocation } from "react-router";
import { Logo } from "./logo.js";
import { ThemeToggle } from "./theme-toggle.js";

interface MenuItem {
  name: string;
  url: string;
  match: "exact" | { start: string };
}

const DONATE_URL = `/purchase/${getPriceId("donation")}`;

/** Fixed items that aren't content pages */
const fixedMenuStart: MenuItem[] = [{ name: "Home", url: "/", match: "exact" }];
const fixedMenuEnd: MenuItem[] = [
  { name: "News", url: "/news/1", match: { start: "/news" } },
  { name: "Calendar", url: "/calendar", match: { start: "/calendar" } },
  { name: "Fantasy", url: "/fantasy", match: { start: "/fantasy" } },
];

/** Content pages with isMainMenu: true, sorted by menuOrder */
const contentMenuItems: MenuItem[] = getMainMenuItems().map((page) => ({
  name: page.title,
  url: page.path,
  match: { start: page.path },
}));

const menu: MenuItem[] = [
  ...fixedMenuStart,
  ...contentMenuItems,
  ...fixedMenuEnd,
];

function isActive(pathname: string, item: MenuItem): boolean {
  if (item.match === "exact") return pathname === item.url;
  return pathname.startsWith(item.match.start);
}

const AuthNav: FC<{ variant: "utility" | "nav" }> = ({ variant }) => {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) {
    if (variant === "utility") {
      return <span className="text-sm text-white/70">...</span>;
    }
    return null;
  }

  const loggedIn = !!session.data?.session;
  const label = loggedIn ? "My Account" : "Login";
  const url = loggedIn ? "/members" : "/auth/login";

  if (variant === "utility") {
    return (
      <Link
        to={url}
        className="text-sm text-white/90 transition hover:text-white"
      >
        {label}
      </Link>
    );
  }

  const active = isActive(location.pathname, {
    name: label,
    url,
    match: "exact",
  });

  return (
    <Link
      to={url}
      className={`hover:text-primary inline-block min-w-28 border-b-2 px-3 py-2 text-center text-sm font-medium tracking-wider uppercase transition ${
        active
          ? "border-primary/40 text-primary"
          : "text-dark border-transparent"
      }`}
    >
      {label}
    </Link>
  );
};

const NavItem: FC<{
  item: MenuItem;
  active: boolean;
  mobile?: boolean;
  onClick?: () => void;
}> = ({ item, active, mobile, onClick }) => {
  if (mobile) {
    return (
      <Link
        to={item.url}
        onClick={onClick}
        className={`hover:text-primary block px-3 py-2 text-sm font-medium tracking-wider uppercase transition ${
          active ? "text-primary" : "text-dark"
        }`}
      >
        {item.name}
      </Link>
    );
  }

  return (
    <Link
      to={item.url}
      className={`hover:text-primary inline-block border-b-2 px-3 py-2 text-sm font-medium tracking-wider uppercase transition lg:block ${
        active
          ? "border-primary/40 text-primary"
          : "text-dark border-transparent"
      }`}
    >
      {item.name}
    </Link>
  );
};

export const SiteHeader: FC = () => {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [stickyVisible, setStickyVisible] = useState(false);
  const mastheadRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Sticky bar via IntersectionObserver
  useEffect(() => {
    const masthead = mastheadRef.current;
    if (!masthead) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) {
          setStickyVisible(!entry.isIntersecting);
        }
      },
      { threshold: 0 },
    );

    observer.observe(masthead);
    return () => observer.disconnect();
  }, []);

  // Prevent body scroll when drawer is open + focus management
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    if (drawerOpen) {
      closeButtonRef.current?.focus();
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Focus trap: loop Tab between first and last focusable elements, Escape closes
  const handleDrawerKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        closeDrawer();
        return;
      }
      if (e.key !== "Tab") return;

      const drawer = drawerRef.current;
      if (!drawer) return;

      const focusable = drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [closeDrawer],
  );

  return (
    <>
      {/* Row 1: Utility Bar */}
      <div className="bg-primary text-white">
        <div className="container mx-auto flex items-center justify-between px-8 py-1.5 text-sm">
          <button
            onClick={openDrawer}
            className="flex items-center p-1 text-white lg:hidden"
            aria-label="Open menu"
          >
            <HamburgerIcon />
          </button>
          <span className="hidden text-white/80 sm:inline">
            Registered Charity 1206787
          </span>
          <div className="flex items-center gap-4 max-sm:ml-auto">
            <AuthNav variant="utility" />
            <ThemeToggle className="p-1 text-white/80 transition hover:text-white" />
            <Link
              to={DONATE_URL}
              className="bg-cta hover:bg-cta-dark rounded-full px-4 py-1 text-sm font-medium text-white transition"
            >
              Donate
            </Link>
          </div>
        </div>
      </div>

      {/* Row 2: Masthead Band — hidden on mobile for marketing landing pages
          (/tell-me-about/*) so the hero is closer to the fold, and hidden
          entirely on /scout/* so the chat fills the viewport. Brand chrome
          stays on every other route. */}
      <div
        ref={mastheadRef}
        className={`bg-creamy py-6 md:py-8 ${
          location.pathname.startsWith("/tell-me-about")
            ? "hidden md:block"
            : ""
        } ${location.pathname.startsWith("/scout") ? "hidden" : ""}`}
      >
        <div className="container mx-auto flex flex-col items-center justify-center gap-3 px-8">
          <Logo size="lg" />
          <h1 className="text-h4 text-dark md:text-h3 mb-0 text-center font-bold">
            Percy Main Community Sports Club
          </h1>
        </div>
      </div>

      {/* Row 3: Navigation (Desktop) */}
      <nav className="border-border bg-surface hidden border-t border-b py-2 lg:block">
        <div className="container mx-auto px-8">
          <ul className="flex items-center justify-center">
            {menu.map((item, i) => (
              <li key={item.name} className="flex items-center">
                {i > 0 && (
                  <span className="bg-border h-4 w-px" aria-hidden="true" />
                )}
                <span className="px-1">
                  <NavItem
                    item={item}
                    active={isActive(location.pathname, item)}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Sticky Collapsed Bar (appears on scroll). Suppressed on /scout/*
          where the masthead is hidden — without the masthead in the DOM
          the IntersectionObserver fires "out of view" instantly and we
          end up rendering the sticky nav alongside the regular Row 3
          nav. The Scout page has its own chrome and doesn't need the
          collapsed bar. */}
      <header
        className={`border-border bg-surface fixed top-0 right-0 left-0 z-50 border-b shadow-sm transition-transform duration-300 ${
          stickyVisible && !location.pathname.startsWith("/scout")
            ? "translate-y-0"
            : "-translate-y-full"
        }`}
      >
        <div className="container mx-auto flex items-center justify-between px-8 py-2">
          <div className="flex items-center gap-3">
            <button
              onClick={openDrawer}
              className="text-dark flex items-center p-1 lg:hidden"
              aria-label="Open menu"
            >
              <HamburgerIcon />
            </button>
            <Logo size="sm" />
          </div>
          <ul className="hidden items-center lg:flex">
            {menu.map((item, i) => (
              <li key={item.name} className="flex items-center">
                {i > 0 && (
                  <span className="bg-border h-4 w-px" aria-hidden="true" />
                )}
                <span className="px-1">
                  <NavItem
                    item={item}
                    active={isActive(location.pathname, item)}
                  />
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3">
            <ThemeToggle className="text-muted hover:text-dark p-1 transition" />
            <Link
              to={DONATE_URL}
              className="bg-cta hover:bg-cta-dark rounded-full px-4 py-1.5 text-sm font-medium text-white transition"
            >
              Donate
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile Drawer Overlay */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 transition-opacity"
          onClick={closeDrawer}
        >
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="bg-surface absolute top-0 right-0 h-full w-72 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleDrawerKeyDown}
          >
            <div className="border-border flex items-center justify-between border-b px-4 py-4">
              <span className="font-secondary text-dark text-lg font-bold">
                Menu
              </span>
              <button
                ref={closeButtonRef}
                onClick={closeDrawer}
                className="text-dark p-2"
                aria-label="Close menu"
              >
                <CloseIcon />
              </button>
            </div>
            <ul className="flex flex-col px-4 py-4">
              {menu.map((item) => (
                <li key={item.name} className="border-border-light border-b">
                  <NavItem
                    item={item}
                    active={isActive(location.pathname, item)}
                    onClick={closeDrawer}
                    mobile
                  />
                </li>
              ))}
              <li className="mt-4">
                <Link
                  to={DONATE_URL}
                  onClick={closeDrawer}
                  className="bg-cta hover:bg-cta-dark block rounded-lg px-5 py-2.5 text-center text-sm font-medium text-white transition"
                >
                  Donate Now
                </Link>
              </li>
              <li className="mt-3">
                <AuthNav variant="nav" />
              </li>
            </ul>
          </div>
        </div>
      )}
    </>
  );
};

const HamburgerIcon: FC = () => (
  <svg className="h-5 w-5 fill-current" viewBox="0 0 20 20">
    <path d="M0 3h20v2H0V3zm0 6h20v2H0V9zm0 6h20v2H0v-2z" />
  </svg>
);

const CloseIcon: FC = () => (
  <svg className="h-5 w-5 fill-current" viewBox="0 0 20 20">
    <polygon
      points="11 9 22 9 22 11 11 11 11 22 9 22 9 11 -2 11 -2 9 9 9 9 -2 11 -2"
      transform="rotate(45 10 10)"
    />
  </svg>
);
