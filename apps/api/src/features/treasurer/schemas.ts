import { z } from "zod";

export const dateRangeSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const paginatedDateRangeSchema = dateRangeSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type DateRange = z.infer<typeof dateRangeSchema>;
export type PaginatedDateRange = z.infer<typeof paginatedDateRangeSchema>;
