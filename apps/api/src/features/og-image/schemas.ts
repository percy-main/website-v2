import { z } from "zod";

export const ogImageParamsSchema = z.object({
  matchId: z.string().regex(/^\d+$/).max(20),
});

// Permissive passthrough — the OG page reflects any non-`og` query params
// back to the SPA via the bypass redirect. Values are coerced to strings;
// non-string entries (e.g. arrays from repeated keys) are dropped rather
// than rejected so a weird URL never breaks the OG meta-tag page.
export const ogPageQuerySchema = z
  .record(z.string(), z.unknown())
  .default({})
  .transform((q) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(q)) {
      if (typeof v !== "string") continue;
      if (k.length > 64 || v.length > 256) continue;
      out[k] = v;
    }
    return out;
  });
