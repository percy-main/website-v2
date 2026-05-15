import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import { context, propagation } from "@opentelemetry/api";
import type { Config } from "../../../config.ts";
import { resolveActiveTaskDefinition } from "../../../lib/ecs-task-definition.ts";
import { runIngest, type RunIngestDeps } from "./run-ingest.ts";

/**
 * Inject the active OTel context into env-var carriers so the spawned
 * worker can extract them and create its root span as a child. See
 * launch.ts in scout/report for the full rationale.
 */
function tracepartEnvOverrides(): Array<{ name: string; value: string }> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  const out: Array<{ name: string; value: string }> = [];
  if (carrier.traceparent) {
    out.push({ name: "OTEL_TRACEPARENT", value: carrier.traceparent });
  }
  if (carrier.tracestate) {
    out.push({ name: "OTEL_TRACESTATE", value: carrier.tracestate });
  }
  return out;
}

export interface LaunchScoutKbOpts {
  config: Config;
  /** Used only when ECS config is unset (local dev). The worker
   *  function runs in-process on the API event loop, fire-and-forget. */
  inProcessDeps: RunIngestDeps;
  documentId: string;
}

export class ScoutKbLaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoutKbLaunchError";
  }
}

/**
 * Launch the scout-kb worker for a queued row. Mirrors
 * `launchScoutReport` exactly — only the container command + env
 * override differ (KB_DOCUMENT_ID vs REPORT_ID, scout-knowledge-worker
 * vs scout-report-worker).
 */
export async function launchScoutKbIngest({
  config,
  inProcessDeps,
  documentId,
}: LaunchScoutKbOpts): Promise<void> {
  const cluster = config.SYNC_ECS_CLUSTER;
  const service = config.SYNC_ECS_SERVICE;
  const subnetsRaw = config.SYNC_ECS_SUBNETS;
  const securityGroup = config.SYNC_ECS_SECURITY_GROUP;

  const ecsConfigured = cluster && service && subnetsRaw && securityGroup;

  if (!ecsConfigured) {
    // Dev fallback. Fire-and-forget — runIngest persists row state
    // before throwing, so the top-level catch is purely belt-and-braces
    // logging.
    void runIngest(inProcessDeps, documentId).catch((err: unknown) => {
      inProcessDeps.logger.error(
        { err, documentId },
        "scout_kb_in_process_runner_failed",
      );
    });
    return;
  }

  const subnets = subnetsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const ecs = new ECSClient({ region: config.AWS_REGION });

  const taskDefinition = await resolveActiveTaskDefinition(
    ecs,
    cluster,
    service,
  );

  const result = await ecs.send(
    new RunTaskCommand({
      cluster,
      taskDefinition,
      launchType: "FARGATE",
      platformVersion: "LATEST",
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets,
          securityGroups: [securityGroup],
          assignPublicIp: config.SYNC_ECS_ASSIGN_PUBLIC_IP
            ? "ENABLED"
            : "DISABLED",
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: "api",
            // Mirror the API's `start` script: --import boots the OTel
            // SDK before any worker code runs. Without it the SDK is
            // never registered, the propagator can't extract from env,
            // and the OTEL_TRACEPARENT injected here would be inert.
            command: [
              "node",
              "--import",
              "./apps/api/dist/instrumentation.js",
              "apps/api/dist/scout-knowledge-worker.js",
            ],
            environment: [
              { name: "KB_DOCUMENT_ID", value: documentId },
              ...tracepartEnvOverrides(),
            ],
          },
        ],
      },
    }),
    { abortSignal: AbortSignal.timeout(10_000) },
  );

  const failure = result.failures?.[0];
  if (failure) {
    throw new ScoutKbLaunchError(
      `ECS RunTask failed: ${failure.reason ?? "unknown"} ${failure.detail ?? ""}`.trim(),
    );
  }

  const taskArn = result.tasks?.[0]?.taskArn;
  if (!taskArn) {
    throw new ScoutKbLaunchError("ECS RunTask returned no task ARN");
  }

  inProcessDeps.logger.info(
    { documentId, taskArn },
    "scout_kb_worker_launched",
  );
}
