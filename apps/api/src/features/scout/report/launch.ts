import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import { context, propagation } from "@opentelemetry/api";
import type { Config } from "../../../config.ts";
import { runReport, type RunReportDeps } from "./run-report.ts";

/**
 * Inject the active OTel context into env-var carriers (traceparent +
 * tracestate) so the spawned worker can extract them and create its
 * root span as a child of the API span. Without this the worker spans
 * land on a separate trace tree in NR and end-to-end latency
 * correlation is impossible.
 *
 * Returns ECS containerOverrides environment entries; empty list when
 * no traceparent is available (instrumentation not booted, or this
 * request runs outside a span).
 */
function tracepartEnvOverrides(): { name: string; value: string }[] {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  const out: { name: string; value: string }[] = [];
  if (carrier.traceparent) {
    out.push({ name: "OTEL_TRACEPARENT", value: carrier.traceparent });
  }
  if (carrier.tracestate) {
    out.push({ name: "OTEL_TRACESTATE", value: carrier.tracestate });
  }
  return out;
}

export interface LaunchScoutReportOpts {
  config: Config;
  /** Used only when ECS config is unset (local dev). The worker function runs
   *  in-process on the API event loop, fire-and-forget. */
  inProcessDeps: RunReportDeps;
  reportId: string;
}

export class ScoutReportLaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoutReportLaunchError";
  }
}

/**
 * Launch the scout-report worker for a queued row.
 *
 * Two paths:
 *
 * 1. **ECS RunTask** (production / staging) — when SYNC_ECS_* are configured,
 *    spawn a Fargate task using the existing API task definition with a
 *    container override to point at the worker entry and inject REPORT_ID.
 *    Mirrors `triggerSync` but with a different command + a per-call env var.
 *
 * 2. **In-process** (local dev) — when SYNC_ECS_* are unset, run the worker
 *    function on the API event loop, fire-and-forget. The chat turn returns
 *    immediately just like the ECS path; the report cooks in the background.
 *    Restarting the dev API kills any in-flight reports — same failure mode
 *    as the inline implementation it replaces.
 *
 * Returns once the launch is acknowledged. Does NOT wait for the report
 * to finish — completion is signalled via the `scout_report` row's status.
 */
export async function launchScoutReport({
  config,
  inProcessDeps,
  reportId,
}: LaunchScoutReportOpts): Promise<void> {
  const cluster = config.SYNC_ECS_CLUSTER;
  const taskDefinition = config.SYNC_ECS_TASK_DEFINITION;
  const subnetsRaw = config.SYNC_ECS_SUBNETS;
  const securityGroup = config.SYNC_ECS_SECURITY_GROUP;

  const ecsConfigured =
    cluster && taskDefinition && subnetsRaw && securityGroup;

  if (!ecsConfigured) {
    // Dev fallback. Fire-and-forget — the row is the source of truth, so the
    // tool's caller doesn't need the promise. Errors thrown out of runReport
    // are already persisted to the row's error_message before the throw, so
    // a top-level catch here is purely belt-and-braces logging.
    void runReport(inProcessDeps, reportId).catch((err: unknown) => {
      inProcessDeps.logger.error(
        { err, reportId },
        "scout_report_in_process_runner_failed",
      );
    });
    return;
  }

  const subnets = subnetsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const ecs = new ECSClient({ region: config.AWS_REGION });

  // RunTask returns once ECS accepts task placement (typically <1s). The
  // worker itself runs entirely inside the Fargate task. Hard-cap at 10s so
  // a stuck/throttled RunTask can't tie up the chat request.
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
              "apps/api/dist/scout-report-worker.js",
            ],
            environment: [
              { name: "REPORT_ID", value: reportId },
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
    throw new ScoutReportLaunchError(
      `ECS RunTask failed: ${failure.reason ?? "unknown"} ${failure.detail ?? ""}`.trim(),
    );
  }

  const taskArn = result.tasks?.[0]?.taskArn;
  if (!taskArn) {
    throw new ScoutReportLaunchError("ECS RunTask returned no task ARN");
  }

  inProcessDeps.logger.info(
    { reportId, taskArn },
    "scout_report_worker_launched",
  );
}
