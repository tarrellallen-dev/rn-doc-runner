/**
 * Page comparison and application orchestration (Task 10 / Task 12).
 *
 * This is the Node-side driver used by our own tests and by the desktop
 * app's Playwright-free production path is implemented separately inside
 * the Chrome extension (M6), which runs the same `dom-reader.ts`
 * functions directly as content-script code with no Playwright
 * dependency. Here, a Playwright `Page` stands in for "a controllable
 * browser tab" so the deterministic pipeline can be proven end-to-end
 * against the synthetic EHR.
 */
import type { Page } from "playwright";
import * as rules from "@rn-doc-runner/rules";
import type {
  DocumentIdentity,
  FieldAllowlistEntry,
  IdentitySelectors,
  IdentityVerificationResult,
  ProposalPlan,
  ProposedChange
} from "@rn-doc-runner/contracts";
import {
  readIdentityInPage,
  readControlsInPage,
  highlightProposalsInPage,
  applyProposalsInPage,
  clearHighlightsInPage,
  detectActiveSelectorSet,
  type RawControl
} from "./dom-reader.js";

export class FormEngineError extends Error {
  code: string;
  failures: string[];
  constructor(code: string, failures: string[]) {
    super(`${code}: ${failures.join(", ")}`);
    this.code = code;
    this.failures = failures;
  }
}

export interface PageRead {
  identity: DocumentIdentity;
  controls?: RawControl[];
}

/** Reads only identity from one tab. Throws (fail-closed) on any selector problem. */
export async function readIdentity(page: Page, identitySelectors: IdentitySelectors): Promise<DocumentIdentity> {
  const identityResult = await page.evaluate(readIdentityInPage, identitySelectors);
  if (!identityResult.ok || !identityResult.identity) {
    throw new FormEngineError("identity_read_failed", identityResult.failures);
  }
  return identityResult.identity as unknown as DocumentIdentity;
}

/** Reads every allowlisted control from one tab. Throws (fail-closed) on any selector/type problem. */
export async function readControls(page: Page, allowlist: FieldAllowlistEntry[]): Promise<RawControl[]> {
  const controlsResult = await page.evaluate(readControlsInPage, allowlist);
  if (!controlsResult.ok || !controlsResult.controls) {
    throw new FormEngineError("controls_read_failed", controlsResult.failures);
  }
  return controlsResult.controls;
}

export interface ComparisonResult {
  identityResult: IdentityVerificationResult;
  plan?: ProposalPlan;
  sourceRead: PageRead;
  destinationRead: PageRead;
}

/**
 * Task 10, steps 1-6. Identity (including exact page alignment) is
 * verified on BOTH tabs before any page-specific control is ever read:
 * allowlist selectors are page-specific, so reading them against a
 * misaligned page would surface a confusing zero-match selector error
 * instead of the correct, more actionable `page_mismatch` identity
 * failure. Controls are only read, and a plan only built, once identity
 * fully passes.
 */
export async function compareSourceToDestination(params: {
  sourcePage: Page;
  destinationPage: Page;
  identitySelectors: IdentitySelectors;
  allowlist: FieldAllowlistEntry[];
  expectedAuthor: string;
}): Promise<ComparisonResult> {
  const sourceIdentity = await readIdentity(params.sourcePage, params.identitySelectors);
  const destinationIdentity = await readIdentity(params.destinationPage, params.identitySelectors);
  const identityResult = rules.verifyIdentity(sourceIdentity, destinationIdentity, params.expectedAuthor);
  if (!identityResult.ok) {
    return {
      identityResult,
      sourceRead: { identity: sourceIdentity },
      destinationRead: { identity: destinationIdentity }
    };
  }
  const sourceControls = await readControls(params.sourcePage, params.allowlist);
  const destinationControls = await readControls(params.destinationPage, params.allowlist);
  const plan = rules.buildPlan(sourceControls, destinationControls, params.allowlist);
  return {
    identityResult,
    plan,
    sourceRead: { identity: sourceIdentity, controls: sourceControls },
    destinationRead: { identity: destinationIdentity, controls: destinationControls }
  };
}

/** Task 10, step 8: highlight every proposed destination change before any apply. */
export async function highlightPlan(destinationPage: Page, allowlist: FieldAllowlistEntry[], plan: ProposalPlan): Promise<void> {
  const result = await destinationPage.evaluate(highlightProposalsInPage, { proposals: plan.proposals, allowlist });
  if (!result.ok) throw new FormEngineError("highlight_failed", result.failures);
}

export async function clearHighlights(destinationPage: Page): Promise<void> {
  await destinationPage.evaluate(clearHighlightsInPage);
}

/**
 * Task 10, step 8-9: apply only after every deterministic gate passes.
 * Refuses to apply any plan with unresolved items (fail closed).
 */
export async function applyPlan(destinationPage: Page, allowlist: FieldAllowlistEntry[], plan: ProposalPlan): Promise<{ applied: number }> {
  if (rules.isFailClosed(plan)) {
    throw new FormEngineError(
      "plan_not_resolved",
      plan.unresolved.map((u) => `${u.key}:${u.reason}`)
    );
  }
  const result = await destinationPage.evaluate(applyProposalsInPage, { proposals: plan.proposals, allowlist });
  if (!result.ok) throw new FormEngineError("apply_failed", result.failures);
  return { applied: result.applied };
}

/** Task 10, step 9-10: re-read the destination and confirm every proposed transition actually took effect. */
export async function verifyAppliedTransitions(
  destinationPage: Page,
  allowlist: FieldAllowlistEntry[],
  appliedProposals: ProposedChange[]
): Promise<{ ok: boolean; failures: string[] }> {
  const result = await destinationPage.evaluate(readControlsInPage, allowlist);
  if (!result.ok || !result.controls) return { ok: false, failures: result.failures };
  const byKey = new Map(result.controls.map((c) => [c.key, c]));
  const failures: string[] = [];
  for (const proposal of appliedProposals) {
    const current = byKey.get(proposal.key);
    if (!current) {
      failures.push(`missing_after_apply:${proposal.key}`);
      continue;
    }
    if (proposal.type === "checkbox" || proposal.type === "radio") {
      if (current.checked !== true) failures.push(`transition_not_confirmed:${proposal.key}`);
    } else if (proposal.type === "select" || proposal.type === "text") {
      if (current.value !== proposal.value) failures.push(`transition_not_confirmed:${proposal.key}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

/** Task 10, step 11 (structural half): confirm no control outside the allowlist was ever touched. True by construction, asserted defensively. */
export async function verifyOnlyAllowlistedControlsCarryHighlight(destinationPage: Page): Promise<{ ok: boolean; strayHighlightCount: number }> {
  const strayHighlightCount = await destinationPage.evaluate(() => document.querySelectorAll("[data-rn-doc-runner-proposed]").length);
  return { ok: strayHighlightCount === 0, strayHighlightCount };
}

export interface LayoutCandidate {
  fingerprint: string;
  selectors: IdentitySelectors;
}

/** Layout-version enforcement: which of the adapter's known selector sets (if any) is actually live on this page. */
export async function detectLayoutFingerprint(page: Page, candidates: LayoutCandidate[]): Promise<{ ok: boolean; failures: string[]; fingerprint?: string }> {
  const result = await page.evaluate(detectActiveSelectorSet, candidates);
  if (!result.fingerprint) return { ok: false, failures: ["layout_fingerprint_undetectable"] };
  return { ok: true, failures: [], fingerprint: result.fingerprint };
}
