import { z } from "zod";

/** Liveness — process is up. Cheap (no deps). */
export const healthLiveResponseSchema = z.object({
  status: z.literal("ok"),
});

/** Readiness — process can serve real traffic (DB reachable). */
export const healthReadyResponseSchema = z.object({
  status: z.enum(["ok", "unhealthy"]),
  database: z.enum(["connected", "disconnected"]),
});

/**
 * Legacy `/health` shape kept for backwards compatibility — older
 * external probes may still call it. Always returns 200 with the
 * "degraded" string on DB outage (the legacy contract).
 */
export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(["connected", "disconnected"]),
});
