import { createClient } from "@percy-main/db";
import { buildApp } from "./app.ts";
import { parseConfig } from "./config.ts";
import { isAbortError } from "./lib/abort-errors.ts";
import { startTlsProxy } from "./lib/tls-proxy.ts";

const config = parseConfig(process.env);
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
//
// Exception: AbortError rejections. better-auth's dash plugin leaks
// them as floating promises when an in-flight operation is cancelled
// (client disconnect / upstream abort). They are request-scoped, so
// exiting would hand any browser tab-close a ~40s prod outage while
// ECS replaces the single task.
process.on("unhandledRejection", (reason: unknown) => {
  if (isAbortError(reason)) {
    app.log.error({ err: reason }, "unhandled_rejection_aborted_operation");
    return;
  }
  app.log.fatal({ err: reason }, "unhandled_rejection");
  process.exit(1);
});
process.on("uncaughtException", (err: Error) => {
  app.log.fatal({ err }, "uncaught_exception");
  process.exit(1);
});

let closeTlsProxy: (() => Promise<void>) | undefined;
app.addHook("onClose", async () => closeTlsProxy?.());

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  if (config.TLS_CERTIFICATE_ARN) {
    if (!config.TLS_KEY_PASSPHRASE) {
      throw new Error(
        "TLS_KEY_PASSPHRASE is required with TLS_CERTIFICATE_ARN",
      );
    }
    const tlsProxy = await startTlsProxy({
      certificateArn: config.TLS_CERTIFICATE_ARN,
      passphrase: config.TLS_KEY_PASSPHRASE,
      port: config.TLS_PORT,
      upstreamPort: config.PORT,
      logger: app.log,
    });
    closeTlsProxy = () =>
      new Promise<void>((resolve) => tlsProxy.close(() => resolve()));
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
