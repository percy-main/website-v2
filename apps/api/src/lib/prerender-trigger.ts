import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../config.ts";

/**
 * Publish-path hook for the prerenderer Lambda
 * (apps/web/server/prerender): any mutation that changes what the public
 * site serves fires one async `reconcile` - the Lambda diffs the live
 * manifest against its state file and re-renders exactly what changed,
 * so callers never compute URLs or distinguish publish from unpublish.
 *
 * Fire-and-forget BY DESIGN: publishing must never fail (or slow down)
 * because rendering is broken. A lost trigger self-heals via the
 * 15-minute reconcile schedule; failures land on the alarms topic
 * through the Lambda's async-invoke on_failure destination.
 */
export interface PrerenderTrigger {
  reconcile(): void;
}

export function createPrerenderTrigger(
  // Optional because minimal integration-test apps register the content
  // routes without decorating app.config; no config = unconfigured.
  config: Config | undefined,
  log: FastifyBaseLogger,
): PrerenderTrigger {
  const functionArn = config?.PRERENDER_LAMBDA_ARN;
  if (config === undefined || functionArn === undefined) {
    return {
      reconcile() {
        log.debug("prerender trigger unconfigured; skipping reconcile");
      },
    };
  }

  const lambda = new LambdaClient({ region: config.AWS_REGION });
  return {
    reconcile() {
      lambda
        .send(
          new InvokeCommand({
            FunctionName: functionArn,
            InvocationType: "Event",
            Payload: Buffer.from(JSON.stringify({ action: "reconcile" })),
          }),
        )
        .then(() => {
          log.info("prerender reconcile triggered");
        })
        .catch((error: unknown) => {
          log.error({ err: error }, "prerender reconcile invoke failed");
        });
    },
  };
}
