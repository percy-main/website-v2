import { Writable } from "node:stream";

export interface LogEntry {
  level: number;
  msg: string;
  [key: string]: unknown;
}

/** Pino level numbers → names */
const LEVEL_NAMES: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

export interface TestLogger {
  /** Pino-compatible stream — pass to Fastify's `loggerInstance` or pino directly */
  stream: Writable;
  /** All captured log entries (parsed JSON) */
  entries: LogEntry[];
  /** Reset captured entries */
  clear(): void;
  /** Filter entries by level name (e.g. "error", "warn") */
  ofLevel(level: string): LogEntry[];
}

/**
 * Creates a silent writable stream that captures Pino log output for assertions.
 *
 * Usage with Fastify:
 * ```ts
 * import { createTestLogger } from "../../test/logger.ts";
 *
 * const logger = createTestLogger();
 * const app = Fastify({
 *   logger: { level: "trace", stream: logger.stream },
 * });
 *
 * // ... run test ...
 *
 * expect(logger.ofLevel("error")).toContainEqual(
 *   expect.objectContaining({ msg: expect.stringContaining("failed") })
 * );
 * logger.clear();
 * ```
 */
export function createTestLogger(): TestLogger {
  const entries: LogEntry[] = [];

  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        const parsed = JSON.parse(chunk.toString()) as LogEntry;
        entries.push(parsed);
      } catch {
        // Ignore non-JSON lines
      }
      callback();
    },
  });

  return {
    stream,
    entries,
    clear() {
      entries.length = 0;
    },
    ofLevel(level: string) {
      const num = Object.entries(LEVEL_NAMES).find(
        ([, name]) => name === level,
      )?.[0];
      if (!num) return [];
      return entries.filter((e) => e.level === Number(num));
    },
  };
}
