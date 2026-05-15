#!/usr/bin/env node
// Fail PR CI if any added/modified migration in packages/db/src/migrations
// contains unsafe DDL patterns (DROP COLUMN, DROP TABLE, SET NOT NULL on
// existing data) **inside the body of `up()`**. Opt-out via a commit
// message token `safe-ddl-ack:` for cases where the change really is safe
// (e.g., column was added in a prior release and never used).
//
// Why AST: every migration has a `down()` that reverses `up()`, so a
// pattern grep over the whole file always fires on any add-column/table
// migration (its down() drops the column/table). That collapses signal
// to zero — contributors learn to slap `safe-ddl-ack:` on by reflex. We
// only care about destructive DDL in the forward direction; parse the
// file with TypeScript and limit the scan to text spans inside `up()`.
//
// Designed to run on PRs (where origin/main..HEAD is non-empty). Skips
// itself silently otherwise. See #305.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const baseRef = process.argv[2] ?? "origin/main";

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function shSafe(cmd) {
  try {
    return sh(cmd);
  } catch {
    return "";
  }
}

// Verify base ref exists; skip silently if not (matches old bash behaviour).
try {
  sh(`git rev-parse --verify ${JSON.stringify(baseRef)}`);
} catch {
  console.log(`check-unsafe-ddl: base ref '${baseRef}' not found, skipping`);
  process.exit(0);
}

// --diff-filter=AM picks up adds + modifies; deletions are ignored
// (undoing a migration is a smell but not this guardrail's job).
const changedRaw = shSafe(
  `git diff --name-only --diff-filter=AM ${JSON.stringify(baseRef)}...HEAD -- 'packages/db/src/migrations/*.ts'`,
);
const changed = changedRaw.split("\n").filter(Boolean);

if (changed.length === 0) {
  console.log("check-unsafe-ddl: no migration files changed");
  process.exit(0);
}

// Patterns (case-insensitive, single regex):
//  - dropColumn / dropTable / setNotNull  — Kysely schema-builder calls
//  - DROP COLUMN / DROP TABLE             — raw SQL
//  - SET NOT NULL                         — raw SQL constraint add
// `setNotNull` matches both `.setNotNull()` (ColumnDefinitionBuilder)
// and `alterColumn(..., (ac) => ac.setNotNull())` — the most common
// Kysely shape for adding NOT NULL to an existing column.
const UNSAFE_PATTERN =
  /dropColumn|dropTable|setNotNull|DROP COLUMN|DROP TABLE|SET NOT NULL/i;

/**
 * Extract the text of `up()`'s body from a migration source file.
 * Returns null if the file does not export a recognisable `up` function —
 * which we treat as a failure (fail closed) because we cannot reason
 * about its DDL safety.
 */
function extractUpBody(file, source) {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TS,
  );

  let body = null;

  function visit(node) {
    if (body) return;
    // export async function up(...) { ... }
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "up" &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      node.body
    ) {
      body = node.body;
      return;
    }
    // export const up = async (...) => { ... }
    // export const up = async function (...) { ... }
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === "up" &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) ||
            ts.isFunctionExpression(decl.initializer)) &&
          decl.initializer.body &&
          ts.isBlock(decl.initializer.body)
        ) {
          body = decl.initializer.body;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  if (!body) return null;
  return source.slice(body.pos, body.end);
}

const hits = [];
const missingUp = [];

for (const file of changed) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    // File was renamed/deleted between diff and read — skip.
    continue;
  }
  const upBody = extractUpBody(file, source);
  if (upBody === null) {
    missingUp.push(file);
    continue;
  }
  if (UNSAFE_PATTERN.test(upBody)) {
    hits.push(file);
  }
}

if (missingUp.length > 0) {
  console.log("::error::Could not locate exported `up()` function in:");
  for (const f of missingUp) console.log(`  - ${f}`);
  console.log("");
  console.log(
    "check-unsafe-ddl expects each migration to export `async function up(...)` (or `const up = async (...) => ...`).",
  );
  process.exit(1);
}

if (hits.length === 0) {
  console.log(
    `check-unsafe-ddl: no unsafe DDL detected in up() across ${changed.length} changed migration(s)`,
  );
  process.exit(0);
}

// Allow opt-out via commit-message token on any commit in the PR range.
const log = shSafe(`git log --format=%B ${JSON.stringify(baseRef)}..HEAD`);
if (/safe-ddl-ack:/.test(log)) {
  console.log(
    "check-unsafe-ddl: unsafe DDL detected but 'safe-ddl-ack:' token present in commit message — allowing",
  );
  for (const f of hits) console.log(`  - ${f}`);
  process.exit(0);
}

console.log(
  `::error::Unsafe DDL detected in up() body. Migrations contain destructive patterns (${UNSAFE_PATTERN.source})`,
);
console.log("Files:");
for (const f of hits) console.log(`  - ${f}`);
console.log("");
console.log(
  "If this change is safe (e.g. backfilled column, gated by feature flag),",
);
console.log(
  "add a 'safe-ddl-ack: <reason>' line to a commit message on this PR.",
);
process.exit(1);
