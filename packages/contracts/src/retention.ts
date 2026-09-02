import { z } from "zod";

/**
 * Retention configuration. Conservative defaults: delete completed
 * patient-level queue data once the RN confirms batch closure.
 */
export const RetentionConfigSchema = z.object({
  deleteCompletedOnBatchClose: z.boolean().default(true),
  completedRetentionDays: z.number().int().nonnegative().default(0),
  exceptionRetentionDays: z.number().int().nonnegative().default(7),
  worklistImageRetentionDays: z.number().int().nonnegative().default(0)
});
export type RetentionConfig = z.infer<typeof RetentionConfigSchema>;

export const DEFAULT_RETENTION_CONFIG: RetentionConfig = RetentionConfigSchema.parse({});
