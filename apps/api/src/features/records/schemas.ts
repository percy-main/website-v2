import { z } from "zod";

export const recordsQuerySchema = z.object({
  isJunior: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export type RecordsQuery = z.infer<typeof recordsQuerySchema>;
