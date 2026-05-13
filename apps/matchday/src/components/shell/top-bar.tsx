import { authClient, useSession } from "@/lib/auth-client.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { mainSiteUrl } from "@/lib/main-site.js";

function initials(name: string | null | undefined, email: string | undefined) {
  const source = (name ?? email ?? "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function TopBar() {
  const { data: session } = useSession();
  const user = session?.user;
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-surface px-4 py-2.5 md:hidden">
      <div className="flex items-center gap-2">
        <div className="grid size-7 place-items-center rounded-md bg-navy text-[11px] font-bold tracking-wide text-white">
          PM
        </div>
        <div>
          <div className="text-[14px] font-bold leading-none">Matchday</div>
          <div className="mt-0.5 text-[11px] text-text-secondary">
            Percy Main CSC
          </div>
        </div>
      </div>
      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="grid size-9 place-items-center rounded-full bg-border text-xs font-semibold text-text-secondary"
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
                void authClient.signOut().then(() => {
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
