import { z } from "zod";

/** Explicit batch state machine states (Task 13 / RN_DOC_RUNNER spec). */
export const BatchStateSchema = z.enum([
  "IMPORTED",
  "OCR_REVIEW",
  "QUEUED",
  "OPEN_CURRENT",
  "VERIFY_CURRENT",
  "FIND_PREDECESSOR",
  "VERIFY_PREDECESSOR",
  "ALIGN_PAGE",
  "COMPARE_PAGE",
  "APPLY_PAGE",
  "VERIFY_PAGE",
  "UPDATE_CONFIGURED_SECTIONS",
  "SAVE_PAGE",
  "VERIFY_SAVE",
  "NEXT_PAGE",
  "DRAFT_COMPLETE",
  "NEEDS_REVIEW",
  "SKIPPED",
  "BLOCKED",
  "PAUSED",
  "EMERGENCY_STOPPED",
  "BATCH_COMPLETE"
]);
export type BatchState = z.infer<typeof BatchStateSchema>;

export const BatchProgressSchema = z.object({
  batchId: z.string().min(1),
  totalEntries: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  currentQueueEntryId: z.string().optional(),
  currentState: BatchStateSchema,
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type BatchProgress = z.infer<typeof BatchProgressSchema>;

export const ExceptionCodeSchema = z.enum([
  "IDENTITY_MISMATCH",
  "PREDECESSOR_NOT_FOUND",
  "PREDECESSOR_AMBIGUOUS",
  "PAGE_MISALIGNED",
  "UNSUPPORTED_FORM",
  "SELECTOR_DRIFT",
  "LAYOUT_VERSION_MISMATCH",
  "CONTRADICTORY_DESTINATION_VALUE",
  "UNRESOLVED_PROPOSAL",
  "RED_LINK_INCOMPLETE",
  "SAVE_VALIDATION_ERROR",
  "SAVE_AMBIGUOUS",
  "SESSION_EXPIRED",
  "EXTENSION_DISCONNECTED",
  "DUPLICATE_WORKLIST_ROW",
  "LOW_OCR_CONFIDENCE",
  "OTHER"
]);
export type ExceptionCode = z.infer<typeof ExceptionCodeSchema>;

/** A skipped/failed queue entry, routed to the exception queue instead of stopping the batch. */
export const ExceptionSchema = z.object({
  id: z.string().min(1),
  queueEntryId: z.string().min(1),
  stage: BatchStateSchema,
  code: ExceptionCodeSchema,
  nonclinicalDetail: z.string(),
  occurredAt: z.string().datetime()
});
export type ExceptionRecord = z.infer<typeof ExceptionSchema>;

/**
 * Last confirmed save checkpoint, used to resume a batch without
 * replaying an ambiguous page.
 *
 * The two key lists are what make a mid-entry resume safe, and they are
 * deliberately kept separate rather than collapsed into one "last key":
 * an entry interrupted between page 1's save and its terminal state must
 * be able to rebuild the full set of pages it already clicked Save on,
 * and it must be able to tell the two kinds apart. A single last-key
 * field cannot express either, which is why this schema carries lists.
 */
export const ResumeCheckpointSchema = z.object({
  batchId: z.string().min(1),
  queueEntryId: z.string().min(1),
  pageIndex: z.number().int().nonnegative(),
  state: BatchStateSchema,
  /** Saves the EHR positively confirmed. On resume these pages are skipped, never re-clicked. */
  confirmedSaveIdempotencyKeys: z.array(z.string()).default([]),
  /**
   * Saves that were clicked but came back AMBIGUOUS. These must never be
   * re-clicked (the click may well have landed) and must never be skipped
   * either (it may well not have) — an entry resumed with any of these
   * goes straight to human review.
   */
  unconfirmedSaveIdempotencyKeys: z.array(z.string()).default([]),
  checkpointedAt: z.string().datetime()
});
export type ResumeCheckpoint = z.infer<typeof ResumeCheckpointSchema>;
