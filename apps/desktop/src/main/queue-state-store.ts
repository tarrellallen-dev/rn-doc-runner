/**
 * Persisted, encrypted resumable batch state (Task 16). Deletes itself
 * once the RN confirms batch closure, per the configured (conservative
 * default) retention policy — see contracts' DEFAULT_RETENTION_CONFIG.
 */
import { DEFAULT_RETENTION_CONFIG, type RetentionConfig, type ResumeCheckpoint, type ExceptionRecord } from "@rn-doc-runner/contracts";
import type { SecureStore } from "./secure-store.js";

export interface PersistedBatchTarget {
  queueEntryId: string;
  criteria: { patient: string; mr: string; form: string; date: string; user: string };
}

export interface PersistedBatchState {
  batchId: string;
  targets: PersistedBatchTarget[];
  completed: string[];
  needsReview: string[];
  blocked: string[];
  skipped: string[];
  exceptions: ExceptionRecord[];
  lastCheckpoint?: ResumeCheckpoint;
  retention: RetentionConfig;
  startedAt: string;
  updatedAt: string;
}

export class QueueStateStore {
  constructor(private readonly store: SecureStore) {}

  save(state: PersistedBatchState): void {
    this.store.write(state);
  }

  load(): PersistedBatchState | undefined {
    return this.store.read<PersistedBatchState>();
  }

  clear(): void {
    this.store.clear();
  }

  exists(): boolean {
    return this.store.exists();
  }

  createInitial(batchId: string, targets: PersistedBatchTarget[], retention: RetentionConfig = DEFAULT_RETENTION_CONFIG): PersistedBatchState {
    const now = new Date().toISOString();
    const state: PersistedBatchState = {
      batchId,
      targets,
      completed: [],
      needsReview: [],
      blocked: [],
      skipped: [],
      exceptions: [],
      retention,
      startedAt: now,
      updatedAt: now
    };
    this.save(state);
    return state;
  }

  /** Called once the RN confirms the batch is closed out (drafts reviewed). Deletes per retention config. */
  applyRetentionOnBatchClose(): void {
    const state = this.load();
    if (!state) return;
    if (state.retention.deleteCompletedOnBatchClose) this.clear();
  }
}
