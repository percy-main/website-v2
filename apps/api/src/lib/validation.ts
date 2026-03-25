import type { FastifyRequest } from "fastify";
import { z } from "zod";

/**
 * Parse and validate request body against a Zod schema.
 * Throws a structured error if validation fails.
 */
export function parseBody<T extends z.ZodType>(
  request: FastifyRequest,
  schema: T,
): z.output<T> {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    const error = new Error("Validation failed") as Error & {
      statusCode: number;
      validation: z.core.$ZodIssue[];
    };
    error.statusCode = 400;
    error.validation = result.error.issues;
    throw error;
  }

  return result.data;
}

/**
 * Parse and validate query parameters against a Zod schema.
 */
export function parseQuery<T extends z.ZodType>(
  request: FastifyRequest,
  schema: T,
): z.output<T> {
  const result = schema.safeParse(request.query);
  if (!result.success) {
    const error = new Error("Query validation failed") as Error & {
      statusCode: number;
      validation: z.core.$ZodIssue[];
    };
    error.statusCode = 400;
    error.validation = result.error.issues;
    throw error;
  }

  return result.data;
}

/**
 * Parse and validate route parameters against a Zod schema.
 */
export function parseParams<T extends z.ZodType>(
  request: FastifyRequest,
  schema: T,
): z.output<T> {
  const result = schema.safeParse(request.params);
  if (!result.success) {
    const error = new Error("Params validation failed") as Error & {
      statusCode: number;
      validation: z.core.$ZodIssue[];
    };
    error.statusCode = 400;
    error.validation = result.error.issues;
    throw error;
  }

  return result.data;
}
