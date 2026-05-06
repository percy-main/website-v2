import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import type { Config } from "../../../config.ts";
import { runIngest, type RunIngestDeps } from "./run-ingest.ts";

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
  const taskDefinition = config.SYNC_ECS_TASK_DEFINITION;
  const subnetsRaw = config.SYNC_ECS_SUBNETS;
  const securityGroup = config.SYNC_ECS_SECURITY_GROUP;

  const ecsConfigured =
    cluster && taskDefinition && subnetsRaw && securityGroup;

  if (!ecsConfigured) {
    // Dev fallback. Fire-and-forget — runIngest persists row state
    // before throwing, so the top-level catch is purely belt-and-braces
    // logging.
    void runIngest(inProcessDeps, documentId).catch((err: unknown) => {
      inProcessDeps.logger?.error(
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
            command: ["node", "apps/api/dist/scout-knowledge-worker.js"],
            environment: [{ name: "KB_DOCUMENT_ID", value: documentId }],
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

  inProcessDeps.logger?.info(
    { documentId, taskArn },
    "scout_kb_worker_launched",
  );
}
