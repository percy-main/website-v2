import { cn } from "@/lib/utils.js";
import type { ReactNode } from "react";

/**
 * Shared non-interactive wrapper for in-editor previews of custom
 * blocks. The `inert` attribute (a React 19 boolean prop) blocks focus
 * and keyboard activation as well as pointer interaction, and carries
 * aria-hidden semantics - so nested forms, buttons and links (contact
 * form submit, cookie-consent reopen, leaderboard URL state, profile
 * links) can't be activated from inside the editor canvas.
 * pointer-events-none stays as a belt-and-braces fallback for browsers
 * with partial inert support.
 */
export function EditorBlockPreview({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div inert className={cn("pointer-events-none select-none", className)}>
      {children}
    </div>
  );
}
