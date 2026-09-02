/** Shared request/response and event shapes between the main process, preload bridge, and renderer. */
import type { WorklistRow, BatchState } from "@rn-doc-runner/contracts";
import type { QueueTarget } from "@rn-doc-runner/queue-engine";
import type { UnresolvedQueueRow } from "../main/resolve-queue-targets.js";

export interface ImportCsvResult {
  rows: WorklistRow[];
  errors: string[];
}

export interface ImportImageResult {
  rows: WorklistRow[];
  skippedLineCount: number;
  orientationApplied?: string;
  error?: string;
}

export interface ImportPdfResult {
  ok: boolean;
  rows: WorklistRow[];
  pageCount: number;
  skippedLineCount: number;
  error?: string;
}

export interface PreviewRowRequest {
  sourcePath: string;
  sourceKind: "image" | "pdf";
  pageNumber?: number;
}

export interface PreviewRowResult {
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

export interface ConfirmQueueResult {
  targets: QueueTarget[];
  unresolved: UnresolvedQueueRow[];
}

export interface BatchProgressSnapshot {
  completed: string[];
  needsReview: string[];
  skipped: string[];
  blocked: string[];
  latestQueueEntryId?: string;
  running: boolean;
}

/** A human-readable label for a queue entry ID — Completed Drafts / Exceptions screens (Phase 2 / Task P2-7). */
export interface QueueEntryLabel {
  queueEntryId: string;
  patient: string;
  form: string;
  date: string;
}

export interface RnDocRunnerApi {
  importWorklistCsv(csvText: string): Promise<ImportCsvResult>;
  importWorklistImage(imagePath: string): Promise<ImportImageResult>;
  importWorklistPdf(pdfPath: string): Promise<ImportPdfResult>;
  previewRow(request: PreviewRowRequest): Promise<PreviewRowResult>;
  confirmQueue(rows: WorklistRow[]): Promise<ConfirmQueueResult>;
  startBatch(targets: QueueTarget[]): Promise<{ ok: boolean; error?: string }>;
  pauseBatch(): Promise<void>;
  unpauseBatch(): Promise<void>;
  emergencyStop(): Promise<void>;
  getBatchProgress(): Promise<BatchProgressSnapshot>;
  /** Task 16: true when an encrypted, persisted batch has entries that never reached a terminal state (e.g. after a crash). */
  hasResumableState(): Promise<boolean>;
  resumeFromCheckpoint(): Promise<{ ok: boolean; error?: string }>;
  clearSession(): Promise<void>;
  deleteImportedWorklist(): Promise<void>;
  onBatchProgress(callback: (snapshot: BatchProgressSnapshot) => void): () => void;
  getEntryLabels(): Promise<QueueEntryLabel[]>;
  openDraftForReview(queueEntryId: string): Promise<{ ok: boolean; error?: string }>;
}

export const CURRENT_AUTHOR = "Nurse, Demo (RN)";
export type { BatchState };
