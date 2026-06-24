import { type Kysely, sql } from "kysely";

// Backfill member.slug across every member, so a member is "linked" by
// default - the slug is the prerequisite for self-editing a profile and the
// source of leaderboard/records/scorecard profile links. Until now slugs
// were set one at a time by an admin in the Record Linking tab, so most
// members had none. This gives every member that lacks one a slug derived
// from their name.
//
// Slug source: slugify(member.name). Collisions are resolved with a numeric
// suffix (-2, -3, ...). The "used" set is seeded with BOTH existing member
// slugs (the partial-unique index would otherwise reject a clash) AND every
// existing person content_item slug. We deliberately never reuse an existing
// person page's slug for an unrelated member: member.slug == a person
// content_item.slug is exactly how the two are linked, so an accidental
// match would land that member on - or let them edit - someone else's
// profile. A member who genuinely owns an existing page but was never linked
// therefore gets a distinct slug here; an admin can re-link them in the
// Record Linking tab. Never mis-linking is the safer default.
//
// Dependents (juniors held under a parent member) have no slug column and
// are untouched. Soft-deleted members (deleted_at) and members with no
// usable name are skipped.
//
// Public 404s: a freshly backfilled slug whose profile page has not been
// authored yet falls back to a member-backed stub profile (name + stats) in
// getPublishedContent, so a leaderboard click never dead-ends in the short
// window before a page exists.

// Exported for unit testing - the collision logic is the only non-trivial
// part of this backfill, so it is covered directly.
export function slugify(name: string): string {
  // NFKD splits an accented letter into a base char + a combining mark; drop
  // the combining marks (U+0300-U+036F) so "José Núñez" -> "jose-nunez"
  // rather than leaving a stray hyphen where each mark was. Everything else
  // non-alphanumeric then collapses to a single hyphen.
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The first slug of the form base, base-2, base-3, ... not already in `used`.
 * Does NOT mutate `used` - the caller records the result so later names in the
 * same run cannot reuse it.
 */
export function nextFreeSlug(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const used = new Set<string>();

  const taken = await sql<{ slug: string }>`
    SELECT slug FROM member WHERE slug IS NOT NULL
    UNION
    SELECT slug FROM content_item WHERE kind = 'person'
  `.execute(db);
  for (const row of taken.rows) used.add(row.slug);

  const members = await sql<{ id: string; name: string | null }>`
    SELECT id, name
    FROM member
    WHERE slug IS NULL AND deleted_at IS NULL
    ORDER BY name ASC, id ASC
  `.execute(db);

  for (const member of members.rows) {
    if (!member.name) continue;
    const base = slugify(member.name);
    if (!base) continue;

    const slug = nextFreeSlug(base, used);
    used.add(slug);

    await sql`UPDATE member SET slug = ${slug} WHERE id = ${member.id}`.execute(
      db,
    );
  }
}
