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
    <header className="border-border bg-surface sticky top-0 z-20 flex items-center justify-between border-b px-4 py-2.5 md:hidden">
      <div className="flex items-center gap-2">
        <img
          src="/images/club_logo.png"
          alt="Percy Main CSC"
          width={28}
          height={28}
          className="size-7 rounded-md object-contain"
          loading="eager"
          fetchPriority="high"
        />
        <div>
          <div className="text-[14px] leading-none font-bold">Matchday</div>
          <div className="text-text-secondary mt-0.5 text-[11px]">
            Percy Main CSC
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
