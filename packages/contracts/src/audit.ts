import { z } from "zod";

/**
 * A nonclinical audit event. MUST NEVER carry patient names, MR numbers,
 * dates, form field values, or free text. Only counts and enumerated
 * nonclinical codes are permitted — enforced structurally by this schema
 * (there is no free-text "value" field).
 */
export const AuditEventSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().datetime(),
  eventType: z.enum([
    "BATCH_STARTED",
    "BATCH_PAUSED",
    "BATCH_RESUMED",
    "BATCH_COMPLETED",
    "EMERGENCY_STOP",
    "QUEUE_ENTRY_STARTED",
    "QUEUE_ENTRY_COMPLETED",
    "QUEUE_ENTRY_SKIPPED",
    "IDENTITY_VERIFIED",
    "IDENTITY_FAILED",
    "PREDECESSOR_FOUND",
    "PROPOSAL_GENERATED",
    "PROPOSAL_APPLIED",
    "PAGE_SAVED",
    "SESSION_CLEARED",
    "ADAPTER_INSTALLED",
    "ADAPTER_INVALIDATED",
    "RETENTION_PURGE"
  ]),
  batchId: z.string().optional(),
  queueEntryId: z.string().optional(),
  stage: z.string().optional(),
  count: z.number().int().nonnegative().optional(),
  nonclinicalCode: z.string().optional()
}).strict();
export type AuditEvent = z.infer<typeof AuditEventSchema>;
