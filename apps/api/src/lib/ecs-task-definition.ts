import { DescribeServicesCommand, type ECSClient } from "@aws-sdk/client-ecs";

export class TaskDefinitionResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskDefinitionResolveError";
  }
}

/**
 * Returns the task-definition ARN the live ECS service is currently
 * running. Worker launchers (Scout report, KB ingest, play-cricket
 * sync) call this and pass the result to RunTask so the spawned task
 * always matches the API revision.
 *
 * Why: passing a bare family name to RunTask resolves to the latest
 * ACTIVE revision. Terraform re-registers a revision with `:latest`
 * on every apply (the image is hardcoded in the module), and `:latest`
 * is no longer published to ECR. The API service has
 * `ignore_changes = [task_definition]` so it ignores the broken
 * revision; this helper extends the same shield to workers.
 */
export async function resolveActiveTaskDefinition(
  ecs: ECSClient,
  cluster: string,
  service: string,
): Promise<string> {
  const result = await ecs.send(
    new DescribeServicesCommand({ cluster, services: [service] }),
    { abortSignal: AbortSignal.timeout(5_000) },
  );
  const arn = result.services?.[0]?.taskDefinition;
  if (!arn) {
    throw new TaskDefinitionResolveError(
      `Could not resolve task-definition for service ${service} in cluster ${cluster}`,
    );
  }
  return arn;
}
