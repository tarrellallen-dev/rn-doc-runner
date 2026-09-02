/**
 * The one chokepoint every click in this package goes through.
 *
 * Structural safety guarantee: no module here calls `page.click` /
 * `page.check` on a caller-supplied selector directly. They call
 * `clickVerifiedControl`, which resolves the selector, requires exactly
 * one match, reads both the control's visible text AND its accessible
 * name (aria-label / aria-labelledby / title), refuses anything matching
 * @rn-doc-runner/rules' FINALIZATION_PATTERN, requires the visible text
 * to equal the label the caller declared it expected, and only then
 * activates it. A click therefore cannot be added anywhere in
 * form-engine without stating, at the call site, what the control is
 * supposed to say — and a configuration that points any of those
 * selectors at Sign / Submit / Send to Office / Finalize is refused
 * before anything is activated.
 *
 * The finalization vocabulary is NOT restated here: `rules.isFinalizationLabel`
 * is the single definition, so widening it widens every guarded click at once.
 */
import type { Page } from "playwright";
import * as rules from "@rn-doc-runner/rules";
import { readButtonLabelInPage, type RawButtonLookup } from "./dom-reader.js";

/** How the control is activated. `check` is for the checkbox inputs Playwright cannot `click` idempotently. */
export type VerifiedControlAction = "click" | "check";

export interface VerifiedControlExpectation {
  /** Short call-site name, appended to every failure code so triage knows which of several controls refused. */
  as: string;
  /**
   * The exact visible text the control must carry (case/whitespace-insensitive).
   * The empty string is a legitimate expectation for a bare `<input type="checkbox">`
   * whose name lives on a wrapping `<label>` and which therefore has no text of its
   * own — the accessible-name and finalization checks below still run on it.
   */
  expect: string;
  action?: VerifiedControlAction;
}

export interface VerifiedControlResult {
  ok: boolean;
  failures: string[];
}

/**
 * The verdict, as a pure function of what was read from the page, so the
 * refusal logic is exercisable without a browser. Every failing check is
 * reported, not just the first: a control that is both mislabeled and
 * carries a finalization accessible name should say so once, not across
 * two runs.
 */
export function verifyControlLabel(lookup: RawButtonLookup, expectation: { as: string; expect: string }): VerifiedControlResult {
  if (!lookup.ok || lookup.label === null) {
    return { ok: false, failures: [`selector_${lookup.matchCount === 0 ? "zero_matches" : "multiple_matches"}:${expectation.as}`] };
  }
  const failures: string[] = [];
  if (rules.isFinalizationLabel(lookup.label)) failures.push(`label_matches_finalization_pattern:${expectation.as}`);
  if (rules.normalize(lookup.label).toLowerCase() !== rules.normalize(expectation.expect).toLowerCase()) {
    failures.push(`label_does_not_match_expected_control:${expectation.as}`);
  }
  // A screen reader announces aria-label/aria-labelledby INSTEAD of visible
  // text, so an element whose text reads "Insert to Form" but whose accessible
  // name (or title attribute) matches the finalization pattern must still be
  // refused — text and accessible name can disagree.
  if (lookup.ariaLabel && rules.isFinalizationLabel(lookup.ariaLabel)) {
    failures.push(`aria_label_matches_finalization_pattern:${expectation.as}`);
  }
  if (lookup.ariaLabelledBy && rules.isFinalizationLabel(lookup.ariaLabelledBy)) {
    failures.push(`aria_labelledby_matches_finalization_pattern:${expectation.as}`);
  }
  if (lookup.title && rules.isFinalizationLabel(lookup.title)) {
    failures.push(`title_matches_finalization_pattern:${expectation.as}`);
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Reads the control, applies `verifyControlLabel`, and activates it only
 * if every check passed. On any failure nothing is clicked, checked,
 * focused or otherwise touched: the read is the only interaction that
 * happened.
 */
export async function clickVerifiedControl(
  page: Page,
  selector: string,
  expectation: VerifiedControlExpectation
): Promise<VerifiedControlResult> {
  const lookup = await page.evaluate(readButtonLabelInPage, selector);
  const verdict = verifyControlLabel(lookup, expectation);
  if (!verdict.ok) return verdict;

  if (expectation.action === "check") {
    await page.check(selector);
  } else {
    await page.click(selector);
  }
  return { ok: true, failures: [] };
}
