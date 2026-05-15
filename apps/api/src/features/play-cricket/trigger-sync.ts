import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import type { Config } from "../../config.ts";
import { resolveActiveTaskDefinition } from "../../lib/ecs-task-definition.ts";

export interface TriggerSyncResult {
  taskArn: string;
}

export class SyncNotConfiguredError extends Error {
  constructor() {
    super("Admin sync trigger is not configured for this environment");
    this.name = "SyncNotConfiguredError";
  }
}

export class SyncLaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncLaunchError";
  }
}

export function triggerSync(config: Config) {
  return async (): Promise<TriggerSyncResult> => {
    const cluster = config.SYNC_ECS_CLUSTER;
    const service = config.SYNC_ECS_SERVICE;
    const subnetsRaw = config.SYNC_ECS_SUBNETS;
    const securityGroup = config.SYNC_ECS_SECURITY_GROUP;

    if (!cluster || !service || !subnetsRaw || !securityGroup) {
      throw new SyncNotConfiguredError();
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

    // RunTask returns once ECS accepts task placement (typically <1s); the sync
    // itself runs entirely inside the spawned Fargate task. Hard-cap at 10s so
    // a stuck/throttled RunTask can't tie up the API request.
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
              command: ["node", "apps/api/dist/sync-runner.js"],
            },
          ],
        },
      }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );

    const failure = result.failures?.[0];
    if (failure) {
      throw new SyncLaunchError(
        `ECS RunTask failed: ${failure.reason ?? "unknown"} ${failure.detail ?? ""}`.trim(),
      );
    }

    const taskArn = result.tasks?.[0]?.taskArn;
    if (!taskArn) {
      throw new SyncLaunchError("ECS RunTask returned no task ARN");
    }

    return { taskArn };
  };
}
