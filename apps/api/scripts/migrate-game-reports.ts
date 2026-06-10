/**
 * One-off migration (#487): import the legacy MDX game reports into the
 * content API's tables as published game_report items.
 *
 * Idempotent: upserts by playCricketId. Unchanged reports are skipped,
 * changed ones are updated (with a revision written), new ones inserted
 * with their creation revision.
 *
 * Usage (local):
 *   DATABASE_URL=postgres://percy:percy@localhost:5433/percy_main \
 *     pnpm exec tsx scripts/migrate-game-reports.ts --user <user-id> [--dry-run]
 *
 * Against prod, run with the standard prod access pattern and the
 * admin_rw URL - coordinate first; never point this at prod casually.
 * Optionally set GAMES_API_BASE (e.g. https://api.v2.percymain.org) to
 * derive human titles from the games API; otherwise titles fall back to
 * "Match report <playCricketId>".
 */
import { createClient } from "@percy-main/db";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  blocksEqualIgnoringIds,
  markdownToBlocks,
  type MigrationBlock,
} from "./markdown-to-blocks.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAMES_DIR = path.resolve(__dirname, "../../web/content/games");

function parseArgs() {
  const args = process.argv.slice(2);
  const userFlag = args.indexOf("--user");
  const userId = userFlag >= 0 ? args[userFlag + 1] : undefined;
  const dryRun = args.includes("--dry-run");
  if (!userId) {
    console.error(
      "Usage: tsx scripts/migrate-game-reports.ts --user <user-id> [--dry-run]",
    );
    process.exit(1);
  }
  return { userId, dryRun };
}

function parseFrontmatter(source: string): {
  playCricketId: string;
  body: string;
} {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!match) throw new Error("No frontmatter block");
  const idMatch = /playCricketId:\s*"?(\d+)"?/.exec(match[1] ?? "");
  const playCricketId = idMatch?.[1];
  if (!playCricketId) throw new Error("No playCricketId in frontmatter");
  return { playCricketId, body: source.slice(match[0].length) };
}

/** Defensive: this corpus has no JSX/imports/images; refuse if one appears. */
function assertPlainMarkdown(body: string, file: string) {
  if (/^\s*import\s/m.test(body) || /<[A-Z][A-Za-z]*/.test(body)) {
    throw new Error(`${file} contains JSX/imports - migrate it by hand`);
  }
  if (/!\[/.test(body)) {
    throw new Error(
      `${file} contains images - upload them through the image pipeline first`,
    );
  }
}

async function fetchTitle(playCricketId: string): Promise<string> {
  const fallback = `Match report ${playCricketId}`;
  const base = process.env.GAMES_API_BASE;
  if (!base) return fallback;
  try {
    const res = await fetch(`${base}/api/games/${playCricketId}`);
    if (!res.ok) return fallback;
    const game = (await res.json()) as {
      team?: { name?: string };
      opposition?: { club?: { name?: string } };
      matchDate?: string;
    };
    if (game.team?.name && game.opposition?.club?.name) {
      const date = game.matchDate ? ` - ${game.matchDate}` : "";
      return `${game.team.name} vs ${game.opposition.club.name}${date}`;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

async function main() {
  const { userId, dryRun } = parseArgs();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const { client: db } = createClient(databaseUrl);

  const files = (await fs.readdir(GAMES_DIR))
    .filter((f) => f.endsWith(".mdx"))
    .sort();
  console.log(`Found ${String(files.length)} reports in ${GAMES_DIR}`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const file of files) {
    const source = await fs.readFile(path.join(GAMES_DIR, file), "utf8");
    const { playCricketId, body } = parseFrontmatter(source);
    assertPlainMarkdown(body, file);

    const blocks: MigrationBlock[] = markdownToBlocks(body);
    const metadata = { playCricketId };
    const title = await fetchTitle(playCricketId);
    const slug = `match-report-${playCricketId}`;

    const existing = await db
      .selectFrom("content_item")
      .select(["id", "body", "title"])
      .where("kind", "=", "game_report")
      .where((eb) =>
        eb(
          eb.fn("jsonb_extract_path_text", [
            eb.ref("metadata"),
            eb.val("playCricketId"),
          ]),
          "=",
          playCricketId,
        ),
      )
      .executeTakeFirst();

    if (existing && blocksEqualIgnoringIds(existing.body, blocks)) {
      skipped += 1;
      console.log(`  = ${file} unchanged (${existing.title})`);
      continue;
    }

    if (dryRun) {
      console.log(
        `  ~ ${file} would ${existing ? "update" : "insert"} '${title}' (${String(blocks.length)} blocks)`,
      );
      continue;
    }

    await db.transaction().execute(async (tx) => {
      if (existing) {
        await tx
          .updateTable("content_item")
          .set({
            body: JSON.stringify(blocks),
            updated_by: userId,
            updated_at: new Date(),
          })
          .where("id", "=", existing.id)
          .execute();
        await tx
          .insertInto("content_revision")
          .values({
            content_id: existing.id,
            title: existing.title,
            description: null,
            body: JSON.stringify(blocks),
            metadata: JSON.stringify(metadata),
            saved_by: userId,
          })
          .execute();
        updated += 1;
        console.log(`  ^ ${file} updated (${existing.title})`);
        return;
      }

      const item = await tx
        .insertInto("content_item")
        .values({
          kind: "game_report",
          slug,
          title,
          description: null,
          body: JSON.stringify(blocks),
          metadata: JSON.stringify(metadata),
          status: "published",
          published_at: new Date(),
          created_by: userId,
          updated_by: userId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("content_revision")
        .values({
          content_id: item.id,
          title,
          description: null,
          body: JSON.stringify(blocks),
          metadata: JSON.stringify(metadata),
          saved_by: userId,
        })
        .execute();
      inserted += 1;
      console.log(`  + ${file} inserted as '${title}'`);
    });
  }

  console.log(
    `Done: ${String(inserted)} inserted, ${String(updated)} updated, ${String(skipped)} unchanged${dryRun ? " (dry run)" : ""}`,
  );
  await db.destroy();
}

await main();
