// Guards the prerenderer's SigV4a signer wiring: the CloudFront KVS data
// plane signs with SigV4a, which @aws-sdk/signature-v4-multi-region
// resolves at runtime from @smithy/signature-v4's signatureV4aContainer.
// lambda.ts registers the pure-JS implementation via a side-effect
// import of @smithy/signature-v4a, but that only works if the bundle
// contains exactly ONE copy of @smithy/signature-v4. A lockfile version
// split (two resolved copies) bundles two container objects - the
// registration writes into one while the signer reads the other, and
// every KVS call fails in prod with "Neither CRT nor JS SigV4a
// implementation is available". This asserts one container + a live
// registration, so a dependency bump that reintroduces the split fails
// the build instead of alerting from the deployed Lambda.
//
// Runs as part of `pnpm --filter web build:ssr`.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ssrDir = resolve(import.meta.dirname, "../dist-server");

if (!existsSync(ssrDir)) {
  console.error(`check-ssr-sigv4a: ${ssrDir} not found - run build:ssr first`);
  process.exit(1);
}

const ssrFiles = readdirSync(ssrDir, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".cjs"));

if (ssrFiles.length === 0) {
  console.error(`check-ssr-sigv4a: no JS bundle found in ${ssrDir}`);
  process.exit(1);
}

let containers = 0;
let registrations = 0;

for (const file of ssrFiles) {
  const code = readFileSync(join(ssrDir, file), "utf8");
  // The container module initialises `{ SignatureV4a: null }` - one match
  // per bundled copy of @smithy/signature-v4. Property names survive
  // minification even if the variable name doesn't.
  containers += (code.match(/SignatureV4a:\s*null/g) ?? []).length;
  // The side-effect registration assigns the implementation onto the
  // container. `(?!=)` keeps `typeof x.SignatureV4a === "function"`
  // comparisons from counting as assignments.
  registrations += (code.match(/\.SignatureV4a\s*=(?!=)/g) ?? []).length;
}

if (containers !== 1 || registrations < 1) {
  console.error(
    `check-ssr-sigv4a: expected exactly 1 signatureV4aContainer and >=1 registration in the SSR bundle, found ${String(containers)} container(s) and ${String(registrations)} registration(s).`,
  );
  console.error(
    containers > 1
      ? "Multiple copies of @smithy/signature-v4 are bundled - the lockfile has a version split. Run `pnpm dedupe @smithy/signature-v4`."
      : "The SigV4a registration is missing - check the side-effect import of @smithy/signature-v4a in server/prerender/lambda.ts.",
  );
  process.exit(1);
}

console.log(
  "check-ssr-sigv4a: OK (1 signatureV4aContainer, registration present)",
);
