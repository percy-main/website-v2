/**
 * Pure helpers for the scout page.
 *
 * Extracted so they can be unit-tested without React/DOM. The component
 * still owns react-query and useChat plumbing.
 */

import type { ReportData } from "@percy-main/shared";

export type ScoutMode = "chat" | "debrief" | "scout";
export type ScoutView = "chat" | "reports" | "facts" | "knowledge";
export type ThinkingModeParam = "fast" | "thinking";

export const VIEW_FROM_PARAM: Record<string, ScoutView> = {
  reports: "reports",
  facts: "facts",
  knowledge: "knowledge",
};

/**
 * Resolves the `view` URL search param to a typed ScoutView, falling back
 * to "chat" for missing/unknown values.
 */
export function viewFromParam(param: string | null | undefined): ScoutView {
  if (param == null) return "chat";
  return VIEW_FROM_PARAM[param] ?? "chat";
}

/**
 * Resolves the `think` URL search param. Anything other than the literal
 * string "fast" defaults to "thinking" (the project default — DeepSeek-v4
 * reasons by default).
 */
export function thinkingModeFromParam(
  param: string | null | undefined,
): ThinkingModeParam {
  return param === "fast" ? "fast" : "thinking";
}

interface MessageLike {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  parts: unknown[];
  attachmentIds: string[];
}

/**
 * Filters a list of messages by role. Used to drop tool/system messages
 * before handing initial state to useChat (which only models user+assistant).
 */
export function filterMessagesByRole<
  T extends { role: "user" | "assistant" | "tool" | "system" },
>(messages: T[], roles: ReadonlyArray<T["role"]>): T[] {
  const allowed = new Set(roles);
  return messages.filter((m) => allowed.has(m.role));
}

/**
 * Builds a map of message id -> attachment ids for messages that have
 * attachments. Empty-attachment messages are omitted so a Map.get returns
 * undefined for "no attachments" rather than an empty array, mirroring the
 * usage in scout.tsx.
 */
export function summariseAttachments(
  messages: readonly MessageLike[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const m of messages) {
    if (m.attachmentIds.length > 0) map.set(m.id, m.attachmentIds);
  }
  return map;
}

interface MessagePartsLike {
  parts?: unknown[] | null;
}

/**
 * Walks the messages list newest→oldest looking for an in-flight `data-report`
 * stream part — i.e. a report whose latest snapshot is "generating" and which
 * has no later terminal snapshot (ready/failed) for the same reportId.
 *
 * Returns null when there is no such report. Used to surface a "connection
 * dropped while a report was generating" banner.
 */
export function findInFlightReport(
  messages: readonly MessagePartsLike[],
): ReportData | null {
  const terminalReportIds = new Set<string>();
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i].parts ?? [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j];
      if (
        typeof part !== "object" ||
        part === null ||
        !("type" in part) ||
        (part as { type: unknown }).type !== "data-report"
      ) {
        continue;
      }
      const data = (part as unknown as { data: ReportData }).data;
      if (data.status === "generating") {
        if (!terminalReportIds.has(data.reportId)) return data;
      } else {
        terminalReportIds.add(data.reportId);
      }
    }
  }
  return null;
}
