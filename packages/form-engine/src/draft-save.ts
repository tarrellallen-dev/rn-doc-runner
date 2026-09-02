/**
 * Draft Save Adapter (Task 11) — a narrow, separate component.
 *
 * Structural safety guarantee: this module exposes exactly one clickable
 * action (`saveDraftPage`), it targets exactly one configured selector
 * (the Save Draft control), and it refuses to click anything whose
 * visible label matches the finalization pattern (sign/submit/send to
 * office/finalize/lock/complete) even if a configuration mistake pointed
 * `saveButtonSelector` at the wrong element. There is no exported
 * function anywhere in this module capable of activating a finalization
 * control — see tests/unit/draft-save.test.ts for a standing check of
 * that guarantee.
 */
import type { Page } from "playwright";
import * as rules from "@rn-doc-runner/rules";
import type { IdentitySelectors, ProposalPlan, SaveOutcome } from "@rn-doc-runner/contracts";
import { readIdentity } from "./compare.js";
import { readHiddenFieldValuesInPage, readButtonLabelInPage } from "./dom-reader.js";

export interface DraftSaveConfig {
  saveButtonSelector: string;
  configuredSaveLabel: string;
  successIndicatorSelector: string;
  validationErrorIndicatorSelector: string;
  sessionExpiredIndicatorSelector: string;
  ambiguousIndicatorSelector: string;
  /** Hidden fields (e.g. red-link section status inputs) that must all read "complete" before saving. */
  requiredCompleteFieldSelectors?: string[];
  waitTimeoutMs?: number;
}

export type SaveAttemptOutcome = SaveOutcome | "BLOCKED";

export interface SaveAttemptResult {
  outcome: SaveAttemptOutcome;
  failures: string[];
  idempotencyKey: string;
}

export interface SaveDraftParams {
  destinationPage: Page;
  identitySelectors: IdentitySelectors;
  expectedIdentity: { patient: string; mr: string; form: string; date: string; user: string };
  plan: ProposalPlan;
  appliedVerification: { ok: boolean; failures: string[] };
  config: DraftSaveConfig;
  queueEntryId: string;
  pageIndex: number;
  formVersion: string;
  /** Idempotency keys that have already succeeded in this batch — never re-clicked, no matter how many times this is called. */
  priorSuccessfulKeys: ReadonlySet<string>;
}

/**
 * Task 11, steps 1-11. Every precondition (identity, zero unresolved
 * items, confirmed transitions, red-link completeness, unique save
 * control, non-finalization label) is re-checked immediately before the
 * single click — this function assumes nothing about state established
 * earlier in the batch run. Never retries automatically: one call is one
 * attempt, and it is the caller's (batch state machine's) job to never
 * invoke this again for an idempotency key that already came back
 * AMBIGUOUS or SAVED.
 */
export async function saveDraftPage(params: SaveDraftParams): Promise<SaveAttemptResult> {
  const idempotencyKey = rules.computeIdempotencyKey(params.queueEntryId, params.pageIndex, params.formVersion);

  if (rules.wasAlreadySaved(idempotencyKey, params.priorSuccessfulKeys)) {
    return { outcome: "BLOCKED", failures: ["duplicate_save_attempt_blocked"], idempotencyKey };
  }

  // Step 2: re-verify destination identity and page.
  const identity = await readIdentity(params.destinationPage, params.identitySelectors);
  const identityCheck = rules.matchesExpectedIdentity(identity, params.expectedIdentity);
  if (!identityCheck.ok) {
    return { outcome: "BLOCKED", failures: identityCheck.failures, idempotencyKey };
  }

  // Step 3: zero unresolved items.
  if (rules.isFailClosed(params.plan)) {
    return { outcome: "BLOCKED", failures: ["unresolved_items_present"], idempotencyKey };
  }

  // Step 4: expected changes verified.
  if (!params.appliedVerification.ok) {
    return { outcome: "BLOCKED", failures: params.appliedVerification.failures, idempotencyKey };
  }

  // Step 5: required Recert red-link sections complete.
  if (params.config.requiredCompleteFieldSelectors?.length) {
    const values = await params.destinationPage.evaluate(readHiddenFieldValuesInPage, params.config.requiredCompleteFieldSelectors);
    const incompleteIndex = values.findIndex((v) => v !== "complete");
    if (incompleteIndex !== -1) {
      return { outcome: "BLOCKED", failures: [`red_link_section_incomplete:${params.config.requiredCompleteFieldSelectors[incompleteIndex]}`], idempotencyKey };
    }
  }

  // Steps 6-8: exactly one Save Draft control, correct label, never a finalization label.
  const buttonLookup = await params.destinationPage.evaluate(readButtonLabelInPage, params.config.saveButtonSelector);
  if (!buttonLookup.ok || buttonLookup.label === null) {
    return {
      outcome: "BLOCKED",
      failures: [`selector_${buttonLookup.matchCount === 0 ? "zero_matches" : "multiple_matches"}:save_button`],
      idempotencyKey
    };
  }
  const labelCheck = rules.validateSaveDraftLabel(buttonLookup.label, params.config.configuredSaveLabel);
  if (!labelCheck.ok) {
    return { outcome: "BLOCKED", failures: labelCheck.failures, idempotencyKey };
  }
  // A screen reader announces aria-label/aria-labelledby INSTEAD of visible
  // text, so an element whose text reads "Save Draft" but whose accessible
  // name (or title attribute) matches the finalization pattern must still
  // be blocked — text and accessible name can disagree.
  const accessibilityFailures: string[] = [];
  if (buttonLookup.ariaLabel && rules.isFinalizationLabel(buttonLookup.ariaLabel)) {
    accessibilityFailures.push("aria_label_matches_finalization_pattern");
  }
  if (buttonLookup.ariaLabelledBy && rules.isFinalizationLabel(buttonLookup.ariaLabelledBy)) {
    accessibilityFailures.push("aria_labelledby_matches_finalization_pattern");
  }
  if (buttonLookup.title && rules.isFinalizationLabel(buttonLookup.title)) {
    accessibilityFailures.push("title_matches_finalization_pattern");
  }
  if (accessibilityFailures.length > 0) {
    return { outcome: "BLOCKED", failures: accessibilityFailures, idempotencyKey };
  }

  // Step 9: click once.
  const urlBeforeClick = params.destinationPage.url();
  await params.destinationPage.click(params.config.saveButtonSelector);

  // Step 10: wait for exactly one of the four configured indicators. A
  // form that auto-advances on save must render an indicator that is
  // observable on the page it advances TO — see below for why the
  // navigation on its own is never treated as confirmation.
  const indicatorSelectors = {
    success: params.config.successIndicatorSelector,
    validation: params.config.validationErrorIndicatorSelector,
    sessionExpired: params.config.sessionExpiredIndicatorSelector,
    ambiguous: params.config.ambiguousIndicatorSelector
  };
  const readIndicatorInPage = (sel: { success: string; validation: string; sessionExpired: string; ambiguous: string }) => {
    if (document.querySelector(sel.success)) return "SAVED";
    if (document.querySelector(sel.validation)) return "VALIDATION_ERROR";
    if (document.querySelector(sel.sessionExpired)) return "SESSION_EXPIRED";
    if (document.querySelector(sel.ambiguous)) return "AMBIGUOUS";
    return null;
  };

  const timeout = params.config.waitTimeoutMs ?? 5000;
  let outcome: SaveOutcome;
  const failures: string[] = [];
  try {
    const handle = await params.destinationPage.waitForFunction(readIndicatorInPage, indicatorSelectors, { timeout, polling: 100 });
    outcome = (await handle.jsonValue()) as SaveOutcome;
  } catch {
    // The wait ends without an answer two ways: the timeout elapsed, or
    // the click navigated and tore down the polling context mid-flight.
    // Those are not the same thing, so re-read the indicators once
    // against whatever document is now loaded before classifying.
    const settled = await params.destinationPage.evaluate(readIndicatorInPage, indicatorSelectors).catch(() => null);
    if (settled) {
      outcome = settled as SaveOutcome;
    } else {
      // No configured indicator anywhere, on either document. A bare URL
      // change is NOT a substitute for one: a click that landed on an
      // error page, a session-timeout redirect, or an interstitial
      // changes the URL exactly as a successful auto-advance does, and
      // nothing observable here tells them apart. Fail closed, as every
      // other branch in this module does. AMBIGUOUS routes to human
      // review rather than to an automatic retry, so declining to call
      // an unconfirmed navigation a success costs nothing operationally.
      // The two reasons stay distinct because triage wants them apart:
      // "something happened that we could not confirm" is a different
      // investigation from "nothing appears to have happened at all".
      outcome = "AMBIGUOUS";
      failures.push(
        params.destinationPage.url() !== urlBeforeClick
          ? "save_confirmation_indicator_absent_after_navigation"
          : "save_confirmation_indicator_absent_no_navigation"
      );
    }
  }

  // Step 11: report exactly one of SAVED / VALIDATION_ERROR / SESSION_EXPIRED / AMBIGUOUS.
  return { outcome, failures, idempotencyKey };
}
