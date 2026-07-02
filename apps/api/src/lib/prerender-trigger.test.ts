import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted; the factory runs before the import below.
const sendLambda = vi.fn();

vi.mock("@aws-sdk/client-lambda", () => {
  class InvokeCommand {
    constructor(public input: unknown) {}
  }
  class LambdaClient {
    send = sendLambda;
  }
  return { InvokeCommand, LambdaClient };
});

import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../config.ts";
import { createPrerenderTrigger } from "./prerender-trigger.ts";

function makeLog() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  } as unknown as FastifyBaseLogger & {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

function makeConfig(arn: string | undefined): Config {
  return { PRERENDER_LAMBDA_ARN: arn, AWS_REGION: "eu-west-2" } as Config;
}

/** Let the fire-and-forget promise chain settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  sendLambda.mockReset();
});

describe("createPrerenderTrigger", () => {
  it("is a logged no-op when PRERENDER_LAMBDA_ARN is unset", async () => {
    const log = makeLog();
    const trigger = createPrerenderTrigger(makeConfig(undefined), log);
    trigger.reconcile();
    await flush();
    expect(sendLambda).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalled();
  });

  it("fires an async Event invoke with the reconcile action", async () => {
    sendLambda.mockResolvedValue({});
    const log = makeLog();
    const trigger = createPrerenderTrigger(
      makeConfig("arn:aws:lambda:eu-west-2:123:function:prerenderer"),
      log,
    );
    trigger.reconcile();
    await flush();

    expect(sendLambda).toHaveBeenCalledTimes(1);
    const command = sendLambda.mock.calls[0][0] as {
      input: { FunctionName: string; InvocationType: string; Payload: Buffer };
    };
    expect(command.input.FunctionName).toBe(
      "arn:aws:lambda:eu-west-2:123:function:prerenderer",
    );
    expect(command.input.InvocationType).toBe("Event");
    expect(JSON.parse(command.input.Payload.toString())).toEqual({
      action: "reconcile",
    });
    expect(log.info).toHaveBeenCalled();
  });

  it("never throws when the invoke fails - publish must not break on render trouble", async () => {
    sendLambda.mockRejectedValue(new Error("lambda down"));
    const log = makeLog();
    const trigger = createPrerenderTrigger(
      makeConfig("arn:aws:lambda:eu-west-2:123:function:prerenderer"),
      log,
    );
    expect(() => {
      trigger.reconcile();
    }).not.toThrow();
    await flush();
    expect(log.error).toHaveBeenCalled();
  });
});
