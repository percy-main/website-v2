import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { Email } from "./types.js";

const emailDir = () =>
  process.env.EMAIL_DIR ?? join(process.cwd(), ".emails");

export const devSend = async ({ html, ...rest }: Email) => {
  await mkdir(emailDir(), { recursive: true });
  const now = new Date().toISOString();
  await writeFile(join(emailDir(), `${now}.html`), html);
  await writeFile(
    join(emailDir(), `${now}.json`),
    JSON.stringify(rest, null, 2),
  );
};
