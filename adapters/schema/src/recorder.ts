/**
 * Calibration Mode structural recorder.
 *
 * This function is self-contained (references only DOM globals, no
 * outer-scope imports at runtime) so it can run unmodified either as a
 * Playwright `page.evaluate` callback (our own test harness) or be
 * inlined into the Chrome extension's Calibration Mode content script.
 * It NEVER reads element values, patient headers, MR numbers, dates,
 * narratives, comments, or unrelated text content — only tag name,
 * id/name/data-* attributes, input type, accessible label, and
 * <select> option *values* (vocabulary, not the current selection).
 *
 * Deliberately written as ONE flat function with no nested named
 * helper functions/consts: esbuild's `keepNames` transform (which tsx
 * enables) wraps every named function/const-arrow-function — including
 * nested ones — in an `__name(fn, "name")` call. Those calls survive
 * `Function.prototype.toString()` and break when Playwright re-evaluates
 * the serialized source in an isolated page context, since `__name` only
 * exists in the original module scope. Inlining avoids the wrapper.
 */

export interface CandidateSelectorRaw {
  semanticGuess: string;
  selector: string;
  tagName: string;
  inputType?: string;
  accessibleLabel?: string;
  matchCount: number;
  optionVocabulary?: string[];
}

export interface RawCalibrationExtraction {
  candidateSelectors: CandidateSelectorRaw[];
  zeroMatchWarnings: string[];
  multiMatchWarnings: string[];
}

export const extractCalibrationStructure = (): RawCalibrationExtraction => {
  const candidateSelectors: CandidateSelectorRaw[] = [];
  const zeroMatchWarnings: string[] = [];
  const multiMatchWarnings: string[] = [];

  const candidateElements = document.querySelectorAll("input, select, textarea, a[id], [data-rn-key]");
  candidateElements.forEach((el) => {
    const id = el.getAttribute("id");
    const dataKey = el.getAttribute("data-rn-key");
    const name = el.getAttribute("name");
    const selector = id ? `#${id}` : dataKey ? `[data-rn-key="${dataKey}"]` : name ? `[name="${name}"]` : null;
    if (!selector) return;

    const matchCount = document.querySelectorAll(selector).length;
    const tagName = el.tagName.toLowerCase();
    const inputType = el instanceof HTMLInputElement ? el.type : undefined;

    const ariaLabel = el.getAttribute("aria-label");
    const forLabel = id ? document.querySelector(`label[for="${id}"]`) : null;
    const closestLabel = el.closest("label");
    const accessibleLabel =
      ariaLabel ??
      (forLabel?.textContent ? forLabel.textContent.replace(/\s+/g, " ").trim() : undefined) ??
      (closestLabel?.textContent ? closestLabel.textContent.replace(/\s+/g, " ").trim() : undefined);

    const optionVocabulary =
      el instanceof HTMLSelectElement
        ? Array.from(el.options)
            .map((o) => o.value)
            .filter((v) => v !== "")
        : undefined;
    const semanticGuess = accessibleLabel ?? id ?? name ?? tagName;

    candidateSelectors.push({ semanticGuess, selector, tagName, inputType, accessibleLabel, matchCount, optionVocabulary });
    if (matchCount === 0) zeroMatchWarnings.push(selector);
    if (matchCount > 1) multiMatchWarnings.push(selector);
  });

  return { candidateSelectors, zeroMatchWarnings, multiMatchWarnings };
};
