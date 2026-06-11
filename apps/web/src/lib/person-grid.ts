// The personGrid block's role-preserving prop (#496): `entries` is a
// JSON-stringified array of { slug, role? }, following the contentImage
// `picture` JSON-string-prop precedent. The legacy `slugs` CSV prop is
// kept as a fallback the renderer still reads when entries is absent or
// malformed. Shared between the public renderer (content-body.tsx) and
// the editor block (content-editor.tsx) so both parse identically.

export interface PersonGridEntry {
  slug: string;
  role?: string;
}

/**
 * Parse a JSON-stringified personGrid entries prop. Returns null for
 * anything that is not a wholly valid, non-empty array of
 * { slug, role? } - the caller then falls back to the legacy slugs CSV
 * (malformed stored content degrades, never crashes, per the renderer's
 * conventions). Empty arrays are null so the renderer and editor agree
 * on when the fallback applies.
 * Slugs are trimmed; empty roles are dropped (NULL-for-unset). Roles
 * are otherwise kept verbatim: the editor round-trips entries through
 * this parser on every keystroke, so trimming here would eat the
 * trailing space while someone types a multi-word role.
 */
export function parsePersonGridEntries(
  raw: string | undefined,
): PersonGridEntry[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const entries: PersonGridEntry[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) return null;
    const { slug, role } = item as { slug?: unknown; role?: unknown };
    if (typeof slug !== "string" || slug.trim() === "") return null;
    if (role !== undefined && typeof role !== "string") return null;
    entries.push({
      slug: slug.trim(),
      ...(role ? { role } : {}),
    });
  }
  return entries.length > 0 ? entries : null;
}
