import { createClient } from "@percy-main/db";
import { buildApp } from "./app.ts";
import { parseConfig } from "./config.ts";

const config = parseConfig(process.env as Record<string, string>);
const { client: db, dialect } = createClient(config.DATABASE_URL);
const app = await buildApp({ db, dialect, config });

// Surface unhandled rejections + uncaught exceptions to NR before the
// process exits. ECS will restart the task either way; without these
// the only breadcrumb is the ECS task-stopped event with no stack.
// fatal() flushes Pino's buffer synchronously before exit so the log
// line actually lands.
//
// Both handlers exit(1) because attaching a listener disables Node's
// default crash behaviour — without exiting we'd silently keep running
// in a corrupted state instead of letting ECS restart us cleanly.
process.on("unhandledRejection", (reason: unknown) => {
  app.log.fatal({ err: reason }, "unhandled_rejection");
  process.exit(1);
});
process.on("uncaughtException", (err: Error) => {
  app.log.fatal({ err }, "uncaught_exception");
  process.exit(1);
});

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
