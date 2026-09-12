import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { Email } from "./types.ts";

// Integration test files run as separate concurrent Vitest workers but
// share one process.cwd() — multiple test files exercising sign-up (which
// sends a verification email via this same dev provider) raced on this one
// shared directory, so a slower test could read back a faster, concurrent
// test's email instead of its own. Real local dev has no VITEST_WORKER_ID,
// so this only changes behavior under the test runner; email-viewer's fixed
// `.emails/` path for local dev is unaffected. Exported so integration
// tests that read emails back resolve the exact same directory this
// writes to, rather than duplicating (and risking diverging from) this
// logic themselves.
export function getDevEmailDir(): string {
  return process.env.VITEST_WORKER_ID
    ? join(process.cwd(), `.emails-worker-${process.env.VITEST_WORKER_ID}`)
    : join(process.cwd(), ".emails");
}

const emailDir = getDevEmailDir();

export const devSend = async ({ html, ...rest }: Email) => {
  await mkdir(emailDir, { recursive: true });
  const now = new Date().toISOString();
  await writeFile(join(emailDir, `${now}.html`), html);
  await writeFile(join(emailDir, `${now}.json`), JSON.stringify(rest, null, 2));
};
