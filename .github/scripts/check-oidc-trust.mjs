#!/usr/bin/env node
// Semantic guard for GitHub OIDC trust policies in infra/ (#626 / ADR 057).
//
// The grep tripwire in terraform.yml only catches the literal
// ':pull_request' text. This script closes the gaps a textual match
// leaves open:
//   - a wildcard subject ("repo:org/repo:*") that trusts every PR run
//     without ever mentioning pull_request;
//   - an AssumeRoleWithWebIdentity grant with no :sub condition at all;
//   - a missing :aud condition (token not pinned to sts.amazonaws.com);
//   - widening the plan role's Secrets Manager resource scope.
//
// Every OIDC subject in infra/ must appear verbatim on the allowlist
// below; adding a new trusted subject is a conscious edit here, in the
// same PR as the trust-policy change, where a reviewer sees both.
//
// Regex-based on purpose: the runner has no HCL parser, and the block
// shapes matched are the ones terraform fmt produces in this repo.
// Parsing failures and unknown file types report as errors, so the
// guard fails closed.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2] ?? "infra";

const ALLOWED_SUBJECTS = new Set([
  // Protected branch: deploy pipeline + scheduled drift detection.
  "repo:${var.github_repo}:ref:refs/heads/main",
  // Reviewer-gated GitHub environments.
  "repo:${var.github_repo}:environment:production",
  "repo:${var.github_repo}:environment:terraform-plan",
]);

const SUB_VARIABLE =
  'variable\\s*=\\s*"token\\.actions\\.githubusercontent\\.com:sub"';

const errors = [];
const tfFiles = [];

(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === ".terraform" || entry === "node_modules") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
    } else if (entry.endsWith(".tf")) {
      tfFiles.push(path);
    } else if (entry.endsWith(".tf.json")) {
      errors.push(
        `${path}: .tf.json is not scanned by this guard - convert to HCL or extend check-oidc-trust.mjs`,
      );
    }
  }
})(ROOT);

function blockLabel(block) {
  return block
    .slice(0, block.indexOf("\n"))
    .replace(/\s*\{\s*$/, "")
    .trim();
}

let subConditionCount = 0;

for (const file of tfFiles) {
  const text = readFileSync(file, "utf8");
  // Top-level blocks start at column 0 (terraform fmt guarantees nested
  // content is indented), so splitting before each column-0 token keeps
  // a block header and its body in one chunk.
  const blocks = text.split(/^(?=\S)/m);

  for (const block of blocks) {
    const grantsOidc = block.includes("sts:AssumeRoleWithWebIdentity");
    const subMatches = [...block.matchAll(new RegExp(SUB_VARIABLE, "g"))];

    if (grantsOidc && subMatches.length === 0) {
      errors.push(
        `${file}: "${blockLabel(block)}" grants sts:AssumeRoleWithWebIdentity without a :sub condition`,
      );
    }
    if (
      grantsOidc &&
      !/token\.actions\.githubusercontent\.com:aud"[\s\S]*?"sts\.amazonaws\.com"/.test(
        block,
      )
    ) {
      errors.push(
        `${file}: "${blockLabel(block)}" lacks an :aud condition pinned to sts.amazonaws.com`,
      );
    }

    for (const match of subMatches) {
      subConditionCount += 1;
      const rest = block.slice(match.index + match[0].length);
      const valuesMatch = rest.match(/values\s*=\s*\[([\s\S]*?)\]/);
      if (!valuesMatch) {
        errors.push(
          `${file}: "${blockLabel(block)}" has a :sub condition with no parseable values list`,
        );
        continue;
      }
      for (const [, subject] of valuesMatch[1].matchAll(
        /"((?:[^"\\]|\\.)*)"/g,
      )) {
        if (!ALLOWED_SUBJECTS.has(subject)) {
          errors.push(
            `${file}: OIDC subject "${subject}" is not on the allowlist in check-oidc-trust.mjs. ` +
              `Unreviewed PR subjects (:pull_request, wildcards) must never be trusted with cloud ` +
              `credentials (ADR 057); a genuinely new gated subject must be added to the allowlist ` +
              `in the same PR.`,
          );
        }
      }
    }
  }
}

if (subConditionCount === 0) {
  errors.push(
    `no OIDC :sub conditions found under ${ROOT}/ - the trust policies this guard protects ` +
      `have moved or been rewritten; update check-oidc-trust.mjs to match`,
  );
}

// The plan role keeps secretsmanager:GetSecretValue deliberately (plans
// read plan-time secrets - ADR 057), but only on percy-main secrets.
const sharedMain = join(ROOT, "environments", "shared", "main.tf");
const sharedText = readFileSync(sharedMain, "utf8");
const secretsRead = sharedText.match(
  /Sid\s*=\s*"SecretsRead"[\s\S]*?Resource\s*=\s*"([^"]+)"/,
);
if (!secretsRead) {
  errors.push(
    `${sharedMain}: SecretsRead statement not found - if the plan role's Secrets Manager ` +
      `grant moved, update check-oidc-trust.mjs to assert its scope`,
  );
} else if (!secretsRead[1].endsWith(":secret:*percy-main*")) {
  errors.push(
    `${sharedMain}: SecretsRead resource scope changed to "${secretsRead[1]}" - the plan ` +
      `role's GetSecretValue must stay scoped to :secret:*percy-main*`,
  );
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`::error::${error}`);
  }
  process.exit(1);
}

console.log(
  `OK: ${subConditionCount} OIDC :sub condition(s) across ${tfFiles.length} .tf files, ` +
    `all subjects on the allowlist; SecretsRead scope intact`,
);
