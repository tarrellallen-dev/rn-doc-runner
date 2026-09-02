/**
 * Wires @rn-doc-runner/queue-engine's batch state machine to a real,
 * visible Chromium instance (Playwright) for Synthetic Development
 * Mode — the only mode meaningfully operable today, since the real
 * Devero adapter ships disabled/unconfigured until a facility-approved
 * training tenant and organizational sign-off exist (see
 * docs/DEPLOYMENT_CHECKLIST.md). `patientIdFor` below is a synthetic-
 * fixture convenience for building `/patients/:id/chart` URLs — a real
 * adapter would instead reach the chart by clicking through the EHR's
 * own UI from the opened document, and would resolve form version from
 * the adapter's layout-fingerprint match. See docs/KNOWN_LIMITATIONS.md.
 */
import { chromium, type Browser } from "playwright";
import {
  runBatch,
  createBatchControl,
  findExactPendingRow,
  openVerifiedForm,
  type BatchControl,
  type BatchRunnerDeps,
  type QueueTarget,
  type BatchRunResult
} from "@rn-doc-runner/queue-engine";
import {
  SNV_V1_ADAPTER,
  RECERT_V1_ADAPTER,
  MED_ADMIN_V1_ADAPTER,
  RECERT_V1_RED_LINK_CONFIGS,
  STANDARD_IDENTITY_SELECTORS,
  SYNTHETIC_SITE_ADAPTER
} from "@rn-doc-runner/adapters-synthetic";
import { PATIENTS } from "@rn-doc-runner/synthetic-ehr/fixtures";
import type { DraftSaveConfig } from "@rn-doc-runner/form-engine";

const SAVE_CONFIG: DraftSaveConfig = {
  saveButtonSelector: "#rn-save-draft",
  configuredSaveLabel: "Save Draft",
  successIndicatorSelector: "#rn-save-success",
  validationErrorIndicatorSelector: "#rn-save-validation-error",
  sessionExpiredIndicatorSelector: "#rn-session-expired",
  ambiguousIndicatorSelector: "#rn-save-ambiguous",
  waitTimeoutMs: 8000
};

export interface RunSyntheticBatchOptions {
  baseUrl: string;
  targets: QueueTarget[];
  headless?: boolean;
  onProgress?: (result: Partial<BatchRunResult> & { latestQueueEntryId?: string }) => void;
  /** Task 16 resume: a prior run's result, so already-terminal entries are never reprocessed. */
  resumeFrom?: BatchRunResult;
  /**
   * Phase 2 hardening (real bug found during Mac validation): a real
   * `chromium.launch()` below can take well over a second. If the
   * caller lets this function create the control itself (as it used
   * to, unconditionally), a Pause/Stop request that arrives during
   * that launch window has no control object to attach to yet and is
   * silently dropped — the batch then starts moments later with a
   * fresh, never-stopped control, as if Stop was never clicked. Passing
   * a control created *synchronously*, before this function is even
   * called, closes that window: the caller can request emergencyStop()
   * on it immediately, and runBatch's very first per-entry check will
   * honor it.
   */
  control?: BatchControl & { pause(): void; resume(): void; emergencyStop(): void };
}

export interface RunningBatchHandle {
  control: BatchControl & { pause(): void; resume(): void; emergencyStop(): void };
  resultPromise: Promise<BatchRunResult>;
}

export async function startSyntheticBatch(options: RunSyntheticBatchOptions): Promise<RunningBatchHandle> {
  const control = options.control ?? createBatchControl();
  const browser: Browser = await chromium.launch({ headless: options.headless ?? false });

  const deps: BatchRunnerDeps = {
    baseUrl: options.baseUrl,
    identitySelectors: STANDARD_IDENTITY_SELECTORS,
    expectedAuthor: SYNTHETIC_SITE_ADAPTER.expectedAuthor,
    openNewPage: () => browser.newPage(),
    closePage: (page) => page.close(),
    formAdapterFor: (formType, formVersion) => {
      if (formType === SNV_V1_ADAPTER.formType && formVersion === SNV_V1_ADAPTER.formVersion) return SNV_V1_ADAPTER;
      if (formType === RECERT_V1_ADAPTER.formType && formVersion === RECERT_V1_ADAPTER.formVersion) return RECERT_V1_ADAPTER;
      if (formType === MED_ADMIN_V1_ADAPTER.formType && formVersion === MED_ADMIN_V1_ADAPTER.formVersion) return MED_ADMIN_V1_ADAPTER;
      return undefined;
    },
    formVersionFor: (formType) => {
      if (formType === SNV_V1_ADAPTER.formType) return SNV_V1_ADAPTER.formVersion;
      if (formType === RECERT_V1_ADAPTER.formType) return RECERT_V1_ADAPTER.formVersion;
      if (formType === MED_ADMIN_V1_ADAPTER.formType) return MED_ADMIN_V1_ADAPTER.formVersion;
      return undefined;
    },
    redLinkSectionsFor: (formType, _formVersion, pageIndex) =>
      formType === RECERT_V1_ADAPTER.formType && pageIndex === 1 ? RECERT_V1_RED_LINK_CONFIGS : [],
    draftSaveConfigFor: () => SAVE_CONFIG,
    patientIdFor: (criteria) => PATIENTS.find((p) => p.name === criteria.patient)?.id
  };

  const resultPromise = runBatch(
    options.targets,
    deps,
    control,
    (outcome, progress) => {
      options.onProgress?.({ ...progress, latestQueueEntryId: outcome.queueEntryId });
    },
    options.resumeFrom
  ).finally(() => browser.close());

  return { control, resultPromise };
}

/**
 * "Open Draft for Review" (Phase 2 / Task P2-7): opens a real, visible
 * browser window on the exact same pending document the batch located
 * by criteria, so the RN can look at it — or finish reviewing and
 * sign it herself, in the live record. This is read-only navigation
 * only, reusing the identical Home -> Pending -> exact-row lookup the
 * batch itself uses (Task 7); nothing here clicks Save or any
 * finalization control, and the browser window is deliberately left
 * open afterward for the RN's own manual use — the IPC caller ignores
 * the returned `browser` handle rather than closing it. It's returned
 * only so a test can close it after asserting; a production caller
 * that closed it would defeat the entire point of this function.
 */
export async function openDraftForReview(
  target: QueueTarget,
  baseUrl: string,
  headless?: boolean
): Promise<{ ok: boolean; error?: string; browser?: Browser }> {
  const browser = await chromium.launch({ headless: headless ?? false });
  try {
    const page = await browser.newPage();
    const found = await findExactPendingRow(page, baseUrl, target.criteria);
    if (!found.ok || !found.href) {
      await browser.close();
      return { ok: false, error: found.failures[0] ?? "pending_row_not_found" };
    }
    await openVerifiedForm(page, baseUrl, found.href);
    return { ok: true, browser };
  } catch (error) {
    await browser.close();
    return { ok: false, error: error instanceof Error ? error.message : "open_draft_for_review_failed" };
  }
}
