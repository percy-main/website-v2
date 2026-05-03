import { z } from "zod";

export const accessResponseSchema = z.object({
  allowed: z.boolean(),
  email: z.string().nullable(),
});

export const threadIdParamSchema = z.object({
  threadId: z.uuid(),
});

export const threadSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const listThreadsResponseSchema = z.object({
  threads: z.array(threadSummarySchema),
});

export const createThreadBodySchema = z.object({
  title: z.string().min(1).max(200).default("New thread"),
});

export const createThreadResponseSchema = threadSummarySchema;

// Message parts are AI SDK UIMessage parts (text, tool-call, tool-result,
// reasoning, …). Their schema varies by part type and we don't validate
// shape here — the FE useChat client handles rendering and the agent
// produced them in the first place. Keep as `unknown` so we don't fight
// the type system over an internal AI SDK contract.
export const messageSchema = z.object({
  id: z.uuid(),
  role: z.enum(["user", "assistant", "tool", "system"]),
  parts: z.array(z.unknown()),
  createdAt: z.iso.datetime(),
});

export const getThreadResponseSchema = z.object({
  thread: threadSummarySchema,
  messages: z.array(messageSchema),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
});

export const deleteThreadResponseSchema = z.object({
  ok: z.literal(true),
});
