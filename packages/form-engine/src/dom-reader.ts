/**
 * In-page DOM read/write primitives.
 *
 * Every exported function here is self-contained (only DOM globals, no
 * outer-scope imports at runtime, no nested named helper functions) so it
 * can run unmodified as a Playwright `page.evaluate` callback (our own
 * test/orchestration harness) or be inlined into the Chrome extension's
 * content script for production use. Nested named consts/functions are
 * avoided deliberately: esbuild's `keepNames` transform (enabled by tsx)
 * wraps them in an `__name(fn, "name")` call that does not exist once the
 * function is serialized via `toString()` and re-evaluated in an isolated
 * page context — see @rn-doc-runner/adapter-schema's recorder.ts for the
 * same lesson.
 *
 * Every selector lookup requires an exact single match; zero or multiple
 * matches is always a hard stop, never a first-match fallback.
 */
import type { ControlType, FieldAllowlistEntry, IdentitySelectors } from "@rn-doc-runner/contracts";

export interface RawIdentityResult {
  ok: boolean;
  failures: string[];
  identity?: Record<string, string>;
}

export const readIdentityInPage = (selectors: IdentitySelectors): RawIdentityResult => {
  const failures: string[] = [];
  const identity: Record<string, string> = {};
  const entries = Object.entries(selectors);
  for (let i = 0; i < entries.length; i++) {
    const field = entries[i]![0];
    const selector = entries[i]![1];
    if (!selector) {
      failures.push(`identity_selector_missing:${field}`);
      continue;
    }
    const nodes = document.querySelectorAll(selector);
    if (nodes.length !== 1) {
      failures.push(`selector_${nodes.length === 0 ? "zero_matches" : "multiple_matches"}:${field}`);
      continue;
    }
    identity[field] = (nodes[0]!.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  return { ok: failures.length === 0, failures, identity: failures.length === 0 ? identity : undefined };
};

export interface RawControl {
  key: string;
  type: ControlType;
  group?: string;
  checked?: boolean;
  value?: string;
}

export interface RawControlsResult {
  ok: boolean;
  failures: string[];
  controls?: RawControl[];
}

export const readControlsInPage = (allowlist: FieldAllowlistEntry[]): RawControlsResult => {
  const failures: string[] = [];
  const controls: RawControl[] = [];
  for (let i = 0; i < allowlist.length; i++) {
    const entry = allowlist[i]!;
    const nodes = document.querySelectorAll(entry.selector);
    if (nodes.length !== 1) {
      failures.push(`selector_${nodes.length === 0 ? "zero_matches" : "multiple_matches"}:${entry.key}`);
      continue;
    }
    const el = nodes[0]!;
    if (entry.type === "checkbox" || entry.type === "radio") {
      if (!(el instanceof HTMLInputElement) || el.type !== entry.type) {
        failures.push(`control_type_mismatch:${entry.key}`);
        continue;
      }
      controls.push({ key: entry.key, type: entry.type, group: "group" in entry ? entry.group : undefined, checked: el.checked });
    } else if (entry.type === "select") {
      if (!(el instanceof HTMLSelectElement)) {
        failures.push(`control_type_mismatch:${entry.key}`);
        continue;
      }
      controls.push({ key: entry.key, type: "select", value: el.value });
    } else if (entry.type === "text") {
      if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
        failures.push(`control_type_mismatch:${entry.key}`);
        continue;
      }
      // Raw value, deliberately NOT trimmed/normalized: the exact-GA rule needs the untouched string.
      controls.push({ key: entry.key, type: "text", value: el.value });
    } else {
      failures.push(`prohibited_control_type:${allowlist[i]!.key}`);
    }
  }
  return { ok: failures.length === 0, failures, controls: failures.length === 0 ? controls : undefined };
};

export interface RawApplyOutcome {
  ok: boolean;
  failures: string[];
  applied: number;
}

/**
 * The highlight attribute name, inlined as a literal (not a shared
 * const) everywhere it's used inside a page-evaluated function: a
 * closure over a module-scope const does not survive
 * `Function.prototype.toString()` serialization into an isolated page
 * context — same lesson as the `__name`/keepNames issue above.
 */
export const HIGHLIGHT_ATTRIBUTE_NAME = "data-rn-doc-runner-proposed";

export interface RawProposedChange {
  key: string;
  type: ControlType;
  checked?: boolean;
  value?: string;
}

export const clearHighlightsInPage = (): void => {
  document.querySelectorAll("[data-rn-doc-runner-proposed]").forEach((el) => {
    (el as HTMLElement).style.removeProperty("outline");
    (el as HTMLElement).style.removeProperty("outline-offset");
    el.removeAttribute("data-rn-doc-runner-proposed");
  });
};

export const highlightProposalsInPage = (params: { proposals: RawProposedChange[]; allowlist: FieldAllowlistEntry[] }): RawApplyOutcome => {
  document.querySelectorAll("[data-rn-doc-runner-proposed]").forEach((el) => {
    (el as HTMLElement).style.removeProperty("outline");
    (el as HTMLElement).style.removeProperty("outline-offset");
    el.removeAttribute("data-rn-doc-runner-proposed");
  });
  const failures: string[] = [];
  for (let i = 0; i < params.proposals.length; i++) {
    const proposal = params.proposals[i]!;
    const entry = params.allowlist.find((candidate) => candidate.key === proposal.key);
    if (!entry) {
      failures.push(`proposal_not_allowlisted:${proposal.key}`);
      continue;
    }
    const nodes = document.querySelectorAll(entry.selector);
    if (nodes.length !== 1) {
      failures.push(`selector_${nodes.length === 0 ? "zero_matches" : "multiple_matches"}:${proposal.key}`);
      continue;
    }
    const el = nodes[0] as HTMLElement;
    el.setAttribute("data-rn-doc-runner-proposed", "true");
    el.style.outline = "3px solid #d97706";
    el.style.outlineOffset = "2px";
  }
  return { ok: failures.length === 0, failures, applied: 0 };
};

/**
 * Applies an immutable, already fail-closed-checked proposal list.
 * Re-checks allowlist membership AND selector uniqueness at apply time
 * (not just at plan time), never unchecks a control, never writes a
 * select value outside its allowedValues, and never writes text other
 * than the exact "GA" exception.
 */
export const applyProposalsInPage = (params: { proposals: RawProposedChange[]; allowlist: FieldAllowlistEntry[] }): RawApplyOutcome => {
  const failures: string[] = [];
  let applied = 0;
  for (let i = 0; i < params.proposals.length; i++) {
    const proposal = params.proposals[i]!;
    const entry = params.allowlist.find((candidate) => candidate.key === proposal.key);
    if (!entry) {
      failures.push(`proposal_not_allowlisted:${proposal.key}`);
      continue;
    }
    const nodes = document.querySelectorAll(entry.selector);
    if (nodes.length !== 1) {
      failures.push(`selector_${nodes.length === 0 ? "zero_matches" : "multiple_matches"}:${proposal.key}`);
      continue;
    }
    const el = nodes[0] as HTMLInputElement | HTMLSelectElement;

    if (proposal.type === "checkbox" || proposal.type === "radio") {
      if (proposal.checked !== true) {
        failures.push(`unsafe_boolean_transition:${proposal.key}`);
        continue;
      }
      (el as HTMLInputElement).checked = true;
    } else if (proposal.type === "select") {
      const allowedValues = "allowedValues" in entry ? entry.allowedValues : undefined;
      if (!allowedValues || !allowedValues.includes(proposal.value ?? "")) {
        failures.push(`value_not_allowlisted:${proposal.key}`);
        continue;
      }
      (el as HTMLSelectElement).value = proposal.value ?? "";
    } else if (proposal.type === "text") {
      const exactValue = "exactValue" in entry ? entry.exactValue : undefined;
      if (exactValue !== "GA" || proposal.value !== "GA") {
        failures.push(`unsafe_text_transition:${proposal.key}`);
        continue;
      }
      (el as HTMLInputElement).value = "GA";
    } else {
      failures.push(`unsupported_proposal_type:${proposal.key}`);
      continue;
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    applied += 1;
  }
  document.querySelectorAll("[data-rn-doc-runner-proposed]").forEach((el) => {
    (el as HTMLElement).style.removeProperty("outline");
    (el as HTMLElement).style.removeProperty("outline-offset");
    el.removeAttribute("data-rn-doc-runner-proposed");
  });
  return { ok: failures.length === 0, failures, applied };
};

/** Detects which of two candidate identity-selector sets is live on the current page (layout fingerprinting). */
export const detectActiveSelectorSet = (candidateSets: { fingerprint: string; selectors: IdentitySelectors }[]): { fingerprint: string | null } => {
  for (let i = 0; i < candidateSets.length; i++) {
    const candidate = candidateSets[i]!;
    const values = Object.values(candidate.selectors);
    let allUnique = true;
    for (let j = 0; j < values.length; j++) {
      const selector = values[j];
      if (!selector || document.querySelectorAll(selector).length !== 1) {
        allUnique = false;
        break;
      }
    }
    if (allUnique) return { fingerprint: candidate.fingerprint };
  }
  return { fingerprint: null };
};

/** Reads the live `.value` PROPERTY (not the original HTML attribute) of each hidden status field — used for red-link completion gates. */
export const readHiddenFieldValuesInPage = (selectors: string[]): (string | null)[] => {
  const values: (string | null)[] = [];
  for (let i = 0; i < selectors.length; i++) {
    const el = document.querySelector(selectors[i]!);
    values.push(el instanceof HTMLInputElement ? el.value : null);
  }
  return values;
};

export interface RawButtonLookup {
  ok: boolean;
  matchCount: number;
  label: string | null;
  /** aria-label, if set — a screen reader announces this INSTEAD of visible text, so it must be checked independently: text and accessible name can disagree. */
  ariaLabel: string | null;
  /** Resolved text of every element referenced by aria-labelledby, if set — same rationale as ariaLabel. */
  ariaLabelledBy: string | null;
  /** title attribute — not part of the accessible-name computation when aria-label/aria-labelledby exist, but checked anyway as a further defense-in-depth signal. */
  title: string | null;
}

/** Requires exactly one match; never falls back to the first of several candidates. */
export const readButtonLabelInPage = (selector: string): RawButtonLookup => {
  const nodes = document.querySelectorAll(selector);
  if (nodes.length !== 1) return { ok: false, matchCount: nodes.length, label: null, ariaLabel: null, ariaLabelledBy: null, title: null };
  const el = nodes[0] as HTMLElement;
  const ariaLabelledByIds = el.getAttribute("aria-labelledby");
  const ariaLabelledBy = ariaLabelledByIds
    ? ariaLabelledByIds
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim() || null
    : null;
  return {
    ok: true,
    matchCount: 1,
    label: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
    ariaLabel: el.getAttribute("aria-label"),
    ariaLabelledBy,
    title: el.getAttribute("title")
  };
};
