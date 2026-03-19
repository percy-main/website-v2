import { createClient } from "@percy-main/db";
import { buildApp } from "./app.js";
import { parseConfig } from "./config.js";

const config = parseConfig(process.env as Record<string, string>);
const { client: db, dialect } = createClient(config.DATABASE_URL);
const app = await buildApp({ db, dialect, config });

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
