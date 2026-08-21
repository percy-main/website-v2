#!/usr/bin/env node
// Semantic guard for the Terraform state-lock invariant (#631).
//
// WHERE THE INVARIANT IS DEFINED: `.github/actions/tf-unlock/action.yml`
// (the `only-current-runner` input). In short: no automatic unlock may
// release a lock it did not create. Terraform workflows serialize on
// DIFFERENT concurrency groups over ONE shared backend - PR plans queue
// per environment on `terraform-plan-<env>`, pushes to main and manual
// applies on `deploy-production`, drift on its own group. The groups
// deliberately overlap, so the state lock (not the concurrency group) is
// what stops two runs racing. A broad `runner@*` force-unlock from one
// workflow can therefore clobber a live lock held by another, and two
// writers on one state file is how state gets corrupted.
// `only-current-runner: "true"` scopes the cleanup to the lock this job
// itself took, which makes it provably non-clobbering.
//
// WHY A SCRIPT AND NOT ACTIONLINT: actionlint has no custom-rule
// mechanism. Its config file (`.github/actionlint.yaml`) only configures
// self-hosted runner labels, config variables, and path-based ignore
// patterns. It does validate local composite-action usage - it will
// report a *missing required input* - but it has no way to assert that a
// supplied input holds a particular value. So the presence half of this
// invariant is expressible in actionlint (by marking the input
// required); the value half is not. This companion check covers both,
// in the spirit of check-oidc-trust.mjs.
//
// WHY NOT A GREP: a grep can tell you the string `only-current-runner`
// appears somewhere in a file. It cannot tie an input to the step that
// owns it, distinguish a `with:` block from a comment, or notice a new
// call site that sets nothing at all. This parses the workflow YAML and
// asks the structural question directly.

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseDocument, visit } from "yaml";

const WORKFLOWS = process.argv[2] ?? ".github/workflows";
const ACTION = process.argv[3] ?? ".github/actions/tf-unlock/action.yml";

const TF_UNLOCK = "./.github/actions/tf-unlock";
const INPUT = "only-current-runner";

// The operator-driven unlock workflow is the ONE place a broad sweep is
// legitimate: it inspects the lock and only releases it when the
// operator passes back the exact lock ID it just showed them. As added
// by #701 that workflow does its own conditional delete-item rather than
// calling the composite action, so this exemption currently matches
// nothing. It is here so the rule reads the way the invariant is worded,
// and so adopting the composite action there later does not trip the
// guard. The file being absent is fine - the set is only consulted for
// workflows that exist.
const EXEMPT_WORKFLOWS = new Set(["terraform-unlock-manual.yml"]);

const errors = [];

/** Byte offset -> 1-based line number, for GitHub file annotations. */
function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

/**
 * GitHub stringifies action inputs, so an unquoted YAML `true` and a
 * quoted `"true"` are the same thing at runtime. Anything else - most
 * importantly `"false"`, but equally a `${{ }}` expression whose value a
 * reviewer cannot see - is not.
 */
function isLiteralTrue(value) {
  return value === true || value === "true";
}

// --- The action's own declaration -----------------------------------

let actionDoc;
try {
  actionDoc = parseDocument(readFileSync(ACTION, "utf8"));
} catch (error) {
  errors.push(
    `${ACTION}: could not be read or parsed (${error.message}) - the tf-unlock action this ` +
      `guard protects has moved; update check-tf-unlock-scope.mjs to match`,
  );
}

if (actionDoc) {
  const input = actionDoc.getIn(["inputs", INPUT], true);
  if (!input) {
    errors.push(
      `${ACTION}: no "${INPUT}" input - the state-lock scoping switch this guard protects has ` +
        `been renamed or removed (#631); update check-tf-unlock-scope.mjs to match`,
    );
  }
}

// --- Every call site in every workflow -------------------------------

let callSites = 0;

for (const entry of readdirSync(WORKFLOWS).sort()) {
  if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;

  const path = join(WORKFLOWS, entry);
  const text = readFileSync(path, "utf8");
  const doc = parseDocument(text);

  if (doc.errors.length > 0) {
    errors.push(`${path}: YAML parse error - ${doc.errors[0].message}`);
    continue;
  }

  visit(doc, {
    Map(_key, step) {
      const uses = step.get("uses");
      if (typeof uses !== "string") return;
      // Tolerate a trailing slash; anything else must match exactly.
      if (uses.trim().replace(/\/+$/, "") !== TF_UNLOCK) return;

      callSites += 1;
      if (EXEMPT_WORKFLOWS.has(basename(path))) return;

      const withMap = step.get("with");
      const scalar = withMap?.get?.(INPUT, true);
      const line = lineAt(text, scalar?.range?.[0] ?? step.range[0]);
      const where = `${path}:${line}: step "${step.get("name") ?? uses}"`;

      // Absent is not flagged here: the action's own default decides
      // what absence means, and that default is reviewed on the action
      // itself. What must never happen is a call site explicitly opting
      // OUT of the scoping.
      if (scalar !== undefined && !isLiteralTrue(scalar.value)) {
        errors.push(
          `${where} sets ${INPUT}: ${JSON.stringify(scalar.value)}. Every automatic tf-unlock ` +
            `call site must pass the literal "true" (#631): a broad runner@* sweep can ` +
            `force-unlock a lock held by a different, still-live terraform run and corrupt ` +
            `state. Cross-run recovery belongs in terraform-unlock-manual.yml, where an ` +
            `operator confirms the lock ID first.`,
        );
      }
    },
  });
}

// Fail closed: if the call sites have moved or been renamed, this guard
// is silently protecting nothing.
if (callSites === 0) {
  errors.push(
    `no "uses: ${TF_UNLOCK}" call sites found under ${WORKFLOWS}/ - the steps this guard ` +
      `protects have moved or been rewritten; update check-tf-unlock-scope.mjs to match`,
  );
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`::error::${error}`);
  }
  process.exit(1);
}

console.log(
  `OK: ${callSites} tf-unlock call site(s) across ${WORKFLOWS}/, none opting out of ` +
    `${INPUT} scoping`,
);
