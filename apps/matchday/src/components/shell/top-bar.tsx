import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { signOut, useSession } from "@/lib/auth-client.js";
import { mainSiteUrl } from "@/lib/main-site.js";
import { useLocation } from "react-router";

function initials(name: string | null | undefined, email: string | undefined) {
  const source = (name ?? email ?? "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Page title shown next to the club mark on mobile. Falls back to
 * "Matchday" for anything not in the table — fixture detail and
 * matchday-edit have their own in-page headers, so the generic label
 * is the right behaviour there.
 */
function pageTitle(pathname: string): { title: string; subtitle: string } {
  if (pathname === "/") return { title: "Home", subtitle: "Percy Main CSC" };
  if (pathname.startsWith("/fixtures"))
    return { title: "Fixtures", subtitle: "Percy Main CSC" };
  if (pathname.startsWith("/donations"))
    return { title: "Donations", subtitle: "Percy Main CSC" };
  if (pathname.startsWith("/me"))
    return { title: "Account", subtitle: "Percy Main CSC" };
  if (pathname.startsWith("/availability"))
    return { title: "Availability", subtitle: "Your matches" };
  if (pathname.startsWith("/official/availability"))
    return { title: "Availability", subtitle: "Squad responses" };
  return { title: "Matchday", subtitle: "Percy Main CSC" };
}

export function TopBar() {
  const { data: session } = useSession();
  const user = session?.user;
  const { pathname } = useLocation();
  const { title, subtitle } = pageTitle(pathname);
  return (
    <header className="border-border bg-surface sticky top-0 z-20 flex items-center justify-between border-b px-4 py-2.5 md:hidden">
      <div className="flex min-w-0 items-center gap-2.5">
        <img
          src="/images/club_logo.png"
          alt="Percy Main CSC"
          width={32}
          height={32}
          className="size-8 shrink-0 rounded-md object-contain"
          loading="eager"
          fetchPriority="high"
        />
        <div className="min-w-0">
          <div className="truncate text-[15px] leading-none font-bold tracking-[-0.01em]">
            {title}
          </div>
          <div className="text-text-secondary mt-0.5 truncate text-[11px]">
            {subtitle}
          </div>
        </div>
      </div>
      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="bg-border text-text-secondary grid size-9 place-items-center rounded-full text-xs font-semibold"
            aria-label="Account menu"
          >
            {initials(user.name, user.email)}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{user.name ?? user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={mainSiteUrl("/members")}>Main site →</a>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                void signOut().then(() => {
                  window.location.href = mainSiteUrl("/");
                });
              }}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  );
}
