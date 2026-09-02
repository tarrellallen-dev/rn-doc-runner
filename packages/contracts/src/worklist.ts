import { z } from "zod";

export const WorklistSourceKindSchema = z.enum(["image", "pdf", "csv"]);
export type WorklistSourceKind = z.infer<typeof WorklistSourceKindSchema>;

/** One imported file (photo, PDF, or CSV) that fed a worklist import. */
export const WorklistSourceFileSchema = z.object({
  id: z.string().min(1),
  kind: WorklistSourceKindSchema,
  originalName: z.string().min(1),
  pageCount: z.number().int().positive().default(1),
  ocrConfidence: z.number().min(0).max(1).optional()
});
export type WorklistSourceFile = z.infer<typeof WorklistSourceFileSchema>;

/** A single worklist import batch (one drag-and-drop action). */
export const WorklistImportSchema = z.object({
  id: z.string().min(1),
  importedAt: z.string().datetime(),
  sourceFiles: z.array(WorklistSourceFileSchema),
  ocrProvider: z.string().min(1),
  status: z.enum(["PENDING_OCR", "OCR_COMPLETE", "REVIEWED", "CONFIRMED"])
});
export type WorklistImport = z.infer<typeof WorklistImportSchema>;

/**
 * One extracted row from OCR of a worklist photo/PDF/CSV: patient name,
 * form date, days outstanding, and form/report category when visible.
 * Never store MR number, narratives, or other PHI beyond what is needed
 * to locate the pending document in the EHR.
 */
export const WorklistRowSchema = z.object({
  id: z.string().min(1),
  importId: z.string().min(1),
  sourceFileId: z.string().min(1),
  patientNameRaw: z.string().min(1),
  formDateRaw: z.string().min(1),
  formDateNormalized: z.string().optional(),
  daysOutstanding: z.number().int().nonnegative().optional(),
  formCategory: z.string().optional(),
  confidence: z.number().min(0).max(1),
  rotationCorrected: z.boolean().default(false),
  duplicateOfRowId: z.string().optional(),
  manuallyCorrected: z.boolean().default(false),
  /** Removed rows (Phase 2 correction screen: RN determined OCR mis-detected this row entirely). Excluded from queue confirmation, kept for audit-free undo within the session. */
  removed: z.boolean().default(false),
  /** 1-indexed page of a multi-page PDF this row was extracted from; absent for a single-image or CSV import. */
  sourcePageNumber: z.number().int().positive().optional(),
  rowOrder: z.number().int().nonnegative()
});
export type WorklistRow = z.infer<typeof WorklistRowSchema>;

export const QueueEntryStatusSchema = z.enum([
  "QUEUED",
  "IN_PROGRESS",
  "DRAFT_COMPLETE",
  "NEEDS_REVIEW",
  "SKIPPED",
  "BLOCKED"
]);
export type QueueEntryStatus = z.infer<typeof QueueEntryStatusSchema>;

/** One document to be processed by the batch, derived from a confirmed worklist row. */
export const QueueEntrySchema = z.object({
  id: z.string().min(1),
  worklistRowId: z.string().min(1),
  priority: z.number().int(),
  status: QueueEntryStatusSchema,
  formCategory: z.string().optional(),
  exceptionCode: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type QueueEntry = z.infer<typeof QueueEntrySchema>;
