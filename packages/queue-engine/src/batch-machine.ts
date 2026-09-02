/**
 * Batch state machine (Task 13). Drives one queue entry through every
 * explicit state from OPEN_CURRENT to DRAFT_COMPLETE / NEEDS_REVIEW /
 * SKIPPED / BLOCKED, then moves on to the next entry — one document's
 * failure never stops the remaining queue. Supports pause, resume, and
 * an emergency stop that cancels further action immediately.
 *
 * `patientIdFor` and `formVersionFor` in `BatchRunnerDeps` are
 * synthetic-test-harness conveniences: our fixture EHR needs a stable
 * patient id to build a `/patients/:id/chart` URL, and a way to map an
 * observed form title to the exact adapter form-version string. A real
 * Devero adapter would instead reach the Patient Chart by clicking
 * through the UI from the opened document, and would resolve form
 * version from the adapter's layout-fingerprint match — see
 * docs/KNOWN_LIMITATIONS.md.
 */
import type { Page } from "playwright";
import * as rules from "@rn-doc-runner/rules";
import type {
  BatchState,
  DocumentIdentity,
  ExceptionRecord,
  FormAdapter,
  IdentitySelectors,
  ResumeCheckpoint
} from "@rn-doc-runner/contracts";
import {
  compareSourceToDestination,
  applyPlan,
  verifyAppliedTransitions,
  saveDraftPage,
  completeAllRedLinkSections,
  readIdentity,
  type DraftSaveConfig,
  type RedLinkSectionConfig
} from "@rn-doc-runner/form-engine";
import { findExactPendingRow, openVerifiedForm, matchesExpectedIdentity } from "./navigation.js";
import { findPredecessor } from "./predecessor.js";

export interface QueueTarget {
  queueEntryId: string;
  criteria: { patient: string; mr: string; form: string; date: string; user: string };
}

export interface BatchRunnerDeps {
  baseUrl: string;
  identitySelectors: IdentitySelectors;
  expectedAuthor: string;
  openNewPage: () => Promise<Page>;
  closePage: (page: Page) => Promise<void>;
  formAdapterFor: (formType: string, formVersion: string) => FormAdapter | undefined;
  formVersionFor: (formType: string) => string | undefined;
  redLinkSectionsFor: (formType: string, formVersion: string, pageIndex: number) => RedLinkSectionConfig[];
  draftSaveConfigFor: (formType: string, formVersion: string) => DraftSaveConfig;
  patientIdFor: (criteria: QueueTarget["criteria"]) => string | undefined;
  /**
   * Called after every save attempt, while the entry is still in flight.
   * Persisting these (QueueStateStore already has a `lastCheckpoint`
   * field for exactly this) is what makes resume survive a crash
   * *inside* an entry rather than only between entries: an entry that
   * dies mid-page never returns a `QueueEntryOutcome` at all, so its
   * confirmed saves reach a restart only through this hook.
   */
  onCheckpoint?: (checkpoint: ResumeCheckpoint) => void;
}

export interface BatchControl {
  isPaused(): boolean;
  isStopped(): boolean;
}

export interface QueueEntryOutcome {
  queueEntryId: string;
  finalState: BatchState;
  exceptions: ExceptionRecord[];
  lastCheckpoint?: ResumeCheckpoint;
}

let exceptionSequence = 0;
function makeException(queueEntryId: string, stage: BatchState, code: ExceptionRecord["code"], detail: string): ExceptionRecord {
  exceptionSequence += 1;
  return {
    id: `exc-${exceptionSequence}`,
    queueEntryId,
    stage,
    code,
    nonclinicalDetail: detail,
    occurredAt: new Date().toISOString()
  };
}

/** Processes exactly one queue entry through the full document state machine. Never throws — always resolves to an outcome. */
export async function processQueueEntry(
  target: QueueTarget,
  deps: BatchRunnerDeps,
  control?: BatchControl,
  resumeCheckpoint?: ResumeCheckpoint
): Promise<QueueEntryOutcome> {
  const exceptions: ExceptionRecord[] = [];
  let destinationPage: Page | undefined;
  let sourcePage: Page | undefined;

  const stop = (state: BatchState): QueueEntryOutcome => ({ queueEntryId: target.queueEntryId, finalState: state, exceptions });

  // A checkpoint is only ever about the entry it was written for; one
  // belonging to a different queue entry says nothing about this one.
  const resumed = resumeCheckpoint?.queueEntryId === target.queueEntryId ? resumeCheckpoint : undefined;
  // These accumulate across every page of THIS entry (and across a
  // resume). Constructing them per page — as this loop used to — left
  // saveDraftPage's duplicate-save guard permanently unarmed.
  const confirmedSaveKeys = new Set<string>(resumed?.confirmedSaveIdempotencyKeys ?? []);
  const unconfirmedSaveKeys = new Set<string>(resumed?.unconfirmedSaveIdempotencyKeys ?? []);
  let lastCheckpoint: ResumeCheckpoint | undefined = resumed;

  const checkpoint = (pageIndex: number): ResumeCheckpoint => {
    lastCheckpoint = {
      batchId: "batch",
      queueEntryId: target.queueEntryId,
      pageIndex,
      state: "SAVE_PAGE",
      confirmedSaveIdempotencyKeys: [...confirmedSaveKeys],
      unconfirmedSaveIdempotencyKeys: [...unconfirmedSaveKeys],
      checkpointedAt: new Date().toISOString()
    };
    deps.onCheckpoint?.(lastCheckpoint);
    return lastCheckpoint;
  };

  try {
    if (control?.isStopped()) return stop("EMERGENCY_STOPPED");

    // A page we clicked Save on but could not confirm is never replayed
    // automatically — not even by a resume, which is exactly the moment
    // the temptation exists. Route to a human before touching the record.
    if (unconfirmedSaveKeys.size > 0) {
      exceptions.push(makeException(target.queueEntryId, "SAVE_PAGE", "SAVE_AMBIGUOUS", "resumed_entry_has_unconfirmed_save"));
      return { ...stop("NEEDS_REVIEW"), lastCheckpoint };
    }

    // OPEN_CURRENT
    destinationPage = await deps.openNewPage();
    const found = await findExactPendingRow(destinationPage, deps.baseUrl, target.criteria);
    if (!found.ok || !found.href) {
      exceptions.push(makeException(target.queueEntryId, "OPEN_CURRENT", "IDENTITY_MISMATCH", found.failures.join(",") || "pending_row_not_found"));
      return stop("BLOCKED");
    }
    await openVerifiedForm(destinationPage, deps.baseUrl, found.href);

    // VERIFY_CURRENT
    const destinationIdentity = await readIdentity(destinationPage, deps.identitySelectors);
    const identityMatch = matchesExpectedIdentity(destinationIdentity, target.criteria);
    if (!identityMatch.ok) {
      exceptions.push(makeException(target.queueEntryId, "VERIFY_CURRENT", "IDENTITY_MISMATCH", identityMatch.failures.join(",")));
      return stop("BLOCKED");
    }

    const formVersion = deps.formVersionFor(destinationIdentity.form);
    if (!formVersion) {
      exceptions.push(makeException(target.queueEntryId, "VERIFY_CURRENT", "UNSUPPORTED_FORM", `no_adapter_for_form:${destinationIdentity.form}`));
      return stop("BLOCKED");
    }
    const formAdapter = deps.formAdapterFor(destinationIdentity.form, formVersion);
    if (!formAdapter || !formAdapter.approved) {
      exceptions.push(makeException(target.queueEntryId, "VERIFY_CURRENT", "UNSUPPORTED_FORM", `no_approved_adapter:${destinationIdentity.form}::${formVersion}`));
      return stop("BLOCKED");
    }

    const destinationDateMs = rules.parseUsDate(destinationIdentity.date);
    if (destinationDateMs === null) {
      exceptions.push(makeException(target.queueEntryId, "VERIFY_CURRENT", "IDENTITY_MISMATCH", "destination_date_invalid"));
      return stop("BLOCKED");
    }

    // FIND_PREDECESSOR / VERIFY_PREDECESSOR
    const patientId = deps.patientIdFor(target.criteria);
    if (!patientId) {
      exceptions.push(makeException(target.queueEntryId, "FIND_PREDECESSOR", "PREDECESSOR_NOT_FOUND", "patient_not_resolvable"));
      return stop("BLOCKED");
    }
    sourcePage = await deps.openNewPage();
    const predecessor = await findPredecessor(sourcePage, deps.baseUrl, patientId, {
      formType: destinationIdentity.form,
      expectedAuthor: deps.expectedAuthor,
      destinationDateMs
    });
    if (!predecessor.ok || !predecessor.documentId) {
      const code = predecessor.failures.includes("ambiguous_predecessor_chronology") ? "PREDECESSOR_AMBIGUOUS" : "PREDECESSOR_NOT_FOUND";
      exceptions.push(makeException(target.queueEntryId, "FIND_PREDECESSOR", code, predecessor.failures.join(",")));
      return stop("NEEDS_REVIEW");
    }
    await openVerifiedForm(sourcePage, deps.baseUrl, `/documents/${predecessor.documentId}?page=0`);

    // Walk every page of the approved form adapter.
    for (const formPage of formAdapter.pages) {
      if (control?.isStopped()) return { ...stop("EMERGENCY_STOPPED"), lastCheckpoint };
      while (control?.isPaused()) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (control?.isStopped()) return { ...stop("EMERGENCY_STOPPED"), lastCheckpoint };
      }

      // Resume: a page whose save the EHR already confirmed is not
      // re-opened, re-applied, or re-clicked. `computeIdempotencyKey` is
      // deterministic, so this is the same key saveDraftPage derives below.
      const idempotencyKey = rules.computeIdempotencyKey(target.queueEntryId, formPage.page.pageIndex, formVersion);
      if (confirmedSaveKeys.has(idempotencyKey)) continue;

      await openVerifiedForm(destinationPage, deps.baseUrl, `${new URL(destinationPage.url()).pathname}?page=${formPage.page.pageIndex}`);
      await openVerifiedForm(sourcePage, deps.baseUrl, `/documents/${predecessor.documentId}?page=${formPage.page.pageIndex}`);

      // ALIGN_PAGE / COMPARE_PAGE
      const comparison = await compareSourceToDestination({
        sourcePage,
        destinationPage,
        identitySelectors: deps.identitySelectors,
        allowlist: formPage.allowlist,
        expectedAuthor: deps.expectedAuthor
      });
      if (!comparison.identityResult.ok) {
        exceptions.push(makeException(target.queueEntryId, "COMPARE_PAGE", "PAGE_MISALIGNED", comparison.identityResult.failures.join(",")));
        return stop("NEEDS_REVIEW");
      }
      if (!comparison.plan || rules.isFailClosed(comparison.plan)) {
        exceptions.push(
          makeException(target.queueEntryId, "COMPARE_PAGE", "UNRESOLVED_PROPOSAL", comparison.plan?.unresolved.map((u) => u.reason).join(",") ?? "no_plan")
        );
        return stop("NEEDS_REVIEW");
      }

      // APPLY_PAGE / VERIFY_PAGE
      await applyPlan(destinationPage, formPage.allowlist, comparison.plan);
      const verification = await verifyAppliedTransitions(destinationPage, formPage.allowlist, comparison.plan.proposals);
      if (!verification.ok) {
        exceptions.push(makeException(target.queueEntryId, "VERIFY_PAGE", "UNRESOLVED_PROPOSAL", verification.failures.join(",")));
        return stop("NEEDS_REVIEW");
      }

      // UPDATE_CONFIGURED_SECTIONS
      const redLinkSections = deps.redLinkSectionsFor(destinationIdentity.form, formVersion, formPage.page.pageIndex);
      if (redLinkSections.length) {
        const redLinkResult = await completeAllRedLinkSections(destinationPage, redLinkSections, destinationIdentity.date);
        if (!redLinkResult.ok) {
          exceptions.push(
            makeException(
              target.queueEntryId,
              "UPDATE_CONFIGURED_SECTIONS",
              "RED_LINK_INCOMPLETE",
              redLinkResult.sections.filter((s) => !s.ok).map((s) => `${s.sectionId}:${s.failures.join("|")}`).join(",")
            )
          );
          return stop("NEEDS_REVIEW");
        }
      }

      // SAVE_PAGE / VERIFY_SAVE
      const draftSaveConfig: DraftSaveConfig = {
        ...deps.draftSaveConfigFor(destinationIdentity.form, formVersion),
        requiredCompleteFieldSelectors: redLinkSections.map((s) => s.statusFieldSelector)
      };
      const saveResult = await saveDraftPage({
        destinationPage,
        identitySelectors: deps.identitySelectors,
        expectedIdentity: target.criteria,
        plan: comparison.plan,
        appliedVerification: verification,
        config: draftSaveConfig,
        queueEntryId: target.queueEntryId,
        pageIndex: formPage.page.pageIndex,
        formVersion,
        // Both kinds of already-attempted key: per saveDraftPage's
        // contract an AMBIGUOUS page must never be invoked again either.
        priorSuccessfulKeys: new Set([...confirmedSaveKeys, ...unconfirmedSaveKeys])
      });

      if (saveResult.outcome === "SAVED") confirmedSaveKeys.add(saveResult.idempotencyKey);
      else if (saveResult.outcome === "AMBIGUOUS") unconfirmedSaveKeys.add(saveResult.idempotencyKey);
      checkpoint(formPage.page.pageIndex);

      if (saveResult.outcome === "VALIDATION_ERROR") {
        exceptions.push(makeException(target.queueEntryId, "SAVE_PAGE", "SAVE_VALIDATION_ERROR", "validation_error"));
        return { ...stop("NEEDS_REVIEW"), lastCheckpoint };
      }
      if (saveResult.outcome === "SESSION_EXPIRED") {
        exceptions.push(makeException(target.queueEntryId, "SAVE_PAGE", "SESSION_EXPIRED", "session_expired_pause_for_login"));
        return { ...stop("BLOCKED"), lastCheckpoint };
      }
      if (saveResult.outcome === "AMBIGUOUS" || saveResult.outcome === "BLOCKED") {
        // Never retried automatically — routed straight to human review.
        exceptions.push(makeException(target.queueEntryId, "SAVE_PAGE", "SAVE_AMBIGUOUS", saveResult.failures.join(",") || "ambiguous_save"));
        return { ...stop("NEEDS_REVIEW"), lastCheckpoint };
      }
      // NEXT_PAGE falls through the loop.
    }

    return { ...stop("DRAFT_COMPLETE"), lastCheckpoint };
  } catch (error) {
    exceptions.push(makeException(target.queueEntryId, "BLOCKED", "OTHER", error instanceof Error ? error.constructor.name : "unknown_error"));
    return stop("BLOCKED");
  } finally {
    if (destinationPage) await deps.closePage(destinationPage).catch(() => undefined);
    if (sourcePage) await deps.closePage(sourcePage).catch(() => undefined);
  }
}

export interface BatchRunResult {
  completed: string[];
  needsReview: string[];
  skipped: string[];
  blocked: string[];
  exceptions: ExceptionRecord[];
  /**
   * The most recent save checkpoint this run produced. Carried back into
   * `runBatch` as part of `resumeFrom` so an entry that was interrupted
   * *mid-entry* — never terminal, so never in any of the lists above —
   * restarts at its first unconfirmed page instead of at page 0.
   */
  lastCheckpoint?: ResumeCheckpoint;
}

/**
 * Task 13: one document's failure never stops the remaining queue.
 * Processes entries strictly in order, honoring pause/emergency-stop
 * between entries.
 *
 * Task 16 (resume): pass a prior run's `BatchRunResult` as `resumeFrom`
 * to continue a crashed/paused batch. Any queue entry that already
 * reached a terminal state (completed, needs review, skipped, or
 * blocked) in that prior result is never reprocessed — this is what
 * makes "last confirmed save" resume safe and guarantees an ambiguous
 * page is never silently replayed just because the app restarted.
 *
 * Entry-level skipping is not sufficient on its own, though: an entry
 * interrupted *inside* itself (crash between page 1's save and any
 * terminal state) is in none of those lists, so it is reprocessed — and
 * without `resumeFrom.lastCheckpoint` it would restart at page 0 and
 * re-click Save on pages the EHR has already confirmed. The checkpoint
 * is what carries that entry's confirmed idempotency keys across the
 * restart; `BatchRunnerDeps.onCheckpoint` is how a caller persists it
 * as it is produced, rather than only when an entry finishes.
 */
export async function runBatch(
  targets: QueueTarget[],
  deps: BatchRunnerDeps,
  control?: BatchControl,
  onEntryComplete?: (outcome: QueueEntryOutcome, progress: Readonly<BatchRunResult>) => void,
  resumeFrom?: BatchRunResult
): Promise<BatchRunResult> {
  const result: BatchRunResult = resumeFrom
    ? {
        completed: [...resumeFrom.completed],
        needsReview: [...resumeFrom.needsReview],
        skipped: [...resumeFrom.skipped],
        blocked: [...resumeFrom.blocked],
        exceptions: [...resumeFrom.exceptions],
        lastCheckpoint: resumeFrom.lastCheckpoint
      }
    : { completed: [], needsReview: [], skipped: [], blocked: [], exceptions: [] };
  const alreadyTerminal = new Set([...result.completed, ...result.needsReview, ...result.skipped, ...result.blocked]);

  for (const target of targets) {
    if (alreadyTerminal.has(target.queueEntryId)) continue;
    if (control?.isStopped()) break;
    while (control?.isPaused()) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (control?.isStopped()) break;
    }
    if (control?.isStopped()) break;

    const outcome = await processQueueEntry(target, deps, control, result.lastCheckpoint);
    result.exceptions.push(...outcome.exceptions);
    if (outcome.lastCheckpoint) result.lastCheckpoint = outcome.lastCheckpoint;
    if (outcome.finalState === "DRAFT_COMPLETE") result.completed.push(target.queueEntryId);
    else if (outcome.finalState === "NEEDS_REVIEW") result.needsReview.push(target.queueEntryId);
    else if (outcome.finalState === "SKIPPED") result.skipped.push(target.queueEntryId);
    else result.blocked.push(target.queueEntryId);
    onEntryComplete?.(outcome, result);
  }
  return result;
}

export function createBatchControl(): BatchControl & { pause(): void; resume(): void; emergencyStop(): void } {
  let paused = false;
  let stopped = false;
  return {
    isPaused: () => paused,
    isStopped: () => stopped,
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
    },
    emergencyStop: () => {
      stopped = true;
      paused = false;
    }
  };
}

export type { DocumentIdentity };
