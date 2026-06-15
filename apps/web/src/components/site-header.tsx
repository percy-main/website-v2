import { useSiteNav } from "@/hooks/use-site-nav.js";
import { useSession } from "@/lib/auth-client.js";
import { isFcThemeRoute } from "@/lib/fc-theme.js";
import { getMainMenuItems } from "@/lib/nav.js";
import { getPriceId } from "@/lib/stripe-env.js";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type KeyboardEvent,
} from "react";
import { Link, useLocation } from "react-router";
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

/**
 * Fixed items wrapped around the merged nav's main-menu pages (#493):
 * isMainMenu pages sorted by menuOrder, DB pages overriding static ones
 * at the same path. useSiteNav's static placeholder means the first
 * render already shows the full static menu - no flash or jump while the
 * nav query is in flight, and pre-migration (empty API list) the menu is
 * identical to the old module-level static assembly.
 */
function useMenu(): MenuItem[] {
  const navPages = useSiteNav();
  return useMemo<MenuItem[]>(
    () => [
      ...fixedMenuStart,
      ...getMainMenuItems(navPages).map((page) => ({
        name: page.title,
        url: page.path,
        match: { start: page.path },
      })),
      ...fixedMenuEnd,
    ],
    [navPages],
  );
}

function isActive(pathname: string, item: MenuItem): boolean {
  if (item.match === "exact") return pathname === item.url;
  return pathname.startsWith(item.match.start);
}

const AuthNav: FC<{ variant: "nav" | "bar" }> = ({ variant }) => {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return null;

  const loggedIn = !!session.data?.session;
  const label = loggedIn ? "My Account" : "Login";
  const url = loggedIn ? "/members" : "/auth/login";

  // The account link on the main bar — same box metrics as a NavItem
  // (border-b-2 + py-2) so its baseline lines up with the menu.
  if (variant === "bar") {
    return (
      <Link
        to={url}
        className="hover:text-creamy text-creamy/80 inline-block border-b-2 border-transparent px-3 py-2 text-sm font-medium tracking-wider uppercase transition"
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
      className={`hover:text-creamy inline-block border-b-2 px-3 py-2 text-sm font-medium tracking-wider uppercase transition lg:block ${
        active
          ? "border-creamy text-creamy"
          : "text-creamy/80 border-transparent"
      }`}
    >
      {item.name}
    </Link>
  );
};

export const SiteHeader: FC = () => {
  const location = useLocation();
  const menu = useMenu();
  // The First-Class content theme is fixed (no dark variant) — hide the toggle
  // there; keep it on the standard-theme routes (admin / members / auth).
  const themeToggleHidden = isFcThemeRoute(location.pathname);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

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

  const openDrawer = () => setDrawerOpen(true);
  const closeDrawer = () => setDrawerOpen(false);

  const handleDrawerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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
  };

  return (
    <>
      {/* The single compact fixed bar used on every route — menu and the
          account link (plus a hamburger to the drawer on mobile). */}
      <nav className="border-border bg-cta sticky top-0 z-40 border-b py-2.5">
        <div className="container mx-auto flex items-center justify-between gap-4 px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={openDrawer}
              className="text-creamy flex items-center p-1 lg:hidden"
              aria-label="Open menu"
            >
              <HamburgerIcon />
            </button>
          </div>
          <ul className="hidden items-center lg:flex">
            {menu.map((item, i) => (
              <li key={item.name} className="flex items-center">
                {i > 0 && (
                  <span className="bg-creamy/30 h-4 w-px" aria-hidden="true" />
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
          <div className="flex items-center gap-1">
            {!themeToggleHidden && (
              <ThemeToggle className="text-creamy/80 hover:text-creamy p-1 transition" />
            )}
            <AuthNav variant="bar" />
          </div>
        </div>
      </nav>

      {/* Mobile Drawer Overlay */}
      {drawerOpen && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 bg-black/50 transition-opacity"
          onClick={closeDrawer}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeDrawer();
          }}
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
            <div className="border-border flex items-center justify-between border-b p-4">
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
            <ul className="flex flex-col p-4">
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
  <svg className="size-5 fill-current" viewBox="0 0 20 20">
    <path d="M0 3h20v2H0V3zm0 6h20v2H0V9zm0 6h20v2H0v-2z" />
  </svg>
);

const CloseIcon: FC = () => (
  <svg className="size-5 fill-current" viewBox="0 0 20 20">
    <polygon
      points="11 9 22 9 22 11 11 11 11 22 9 22 9 11 -2 11 -2 9 9 9 9 -2 11 -2"
      transform="rotate(45 10 10)"
    />
  </svg>
);
