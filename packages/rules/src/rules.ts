/**
 * RN DOC Runner deterministic rule engine.
 *
 * Ported from RN DOC OS `LOCAL_OPERATOR_EXTENSION/rules.js` (LOP-001..005)
 * and extended per RN DOC Runner Task 2. This module contains no AI calls,
 * no network access, and no dynamic code execution. Every function is a
 * pure function over plain data so it can run identically inside the
 * Electron main process, the Chrome extension content script, and the
 * Node test runner.
 *
 * Safety invariant: every ambiguous or unverifiable state must resolve to
 * `ok: false` / an `unresolved` entry, never to a silent default that
 * permits a mutation. Do not weaken any check here to make a test pass.
 */
import type {
  ControlType,
  DocumentIdentity,
  FieldAllowlistEntry,
  IdentityVerificationResult,
  ProposalPlan,
  ProposedChange
} from "@rn-doc-runner/contracts";

/**
 * Any label/accessible-name/command matching this pattern is treated as an
 * electronic signature/attestation/submission/finalization control and is
 * never a valid Save Draft target (Phase 2 / Task P2-4). `\w*` suffixes on
 * attest/certif/upload deliberately catch noun/gerund variants
 * (Attestation, Certification, Uploading) that a strict whole-word match
 * on the verb alone would miss.
 */
export const FINALIZATION_PATTERN =
  /\b(sign|submit|send\s+to\s+office|finalize|finalise|lock|complete|activate|attest\w*|certif\w*|upload\w*)\b/i;

/** Keyword guard for label text that must never appear in an allowlist entry. Defense-in-depth only. */
export const PROHIBITED_FIELD_LABEL_PATTERN =
  /\b(vital|pulse|temperature|respirat|blood\s*pressure|o2\s*sat|pain\s*scale|pain\s*score|wound|measurement|dose|dosage|route|medication|administ|comment|narrative|note[s]?|finding|assessment|signature|initial[s]?)\b/i;

export function normalize(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** Strict US M/D/YYYY parser. Returns epoch millis (UTC) or null on any invalid/ambiguous input. */
export function parseUsDate(value: unknown): number | null {
  const match = normalize(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.getTime();
}

const REQUIRED_IDENTITY_FIELDS = ["patient", "mr", "form", "date", "author", "page"] as const;

/**
 * Exact patient, MR, form, page match; exact authorized-source-author
 * match; and source date strictly earlier than destination date.
 * Fails closed (ok:false) on any missing, unparseable, or mismatched field.
 */
export function verifyIdentity(
  source: Partial<DocumentIdentity> | null | undefined,
  destination: Partial<DocumentIdentity> | null | undefined,
  expectedAuthor: string
): IdentityVerificationResult {
  const failures: string[] = [];
  for (const field of REQUIRED_IDENTITY_FIELDS) {
    if (!normalize(source?.[field])) failures.push(`source_${field}_missing`);
    if (!normalize(destination?.[field])) failures.push(`destination_${field}_missing`);
  }
  if (failures.length) return { ok: false, failures };

  const s = source as DocumentIdentity;
  const d = destination as DocumentIdentity;

  if (normalize(s.patient) !== normalize(d.patient)) failures.push("patient_mismatch");
  if (normalize(s.mr) !== normalize(d.mr)) failures.push("mr_mismatch");
  if (normalize(s.form) !== normalize(d.form)) failures.push("form_mismatch");
  if (normalize(s.page) !== normalize(d.page)) failures.push("page_mismatch");
  if (normalize(s.author) !== normalize(expectedAuthor)) failures.push("source_author_mismatch");

  const sourceDate = parseUsDate(s.date);
  const destinationDate = parseUsDate(d.date);
  if (sourceDate === null) failures.push("source_date_invalid");
  if (destinationDate === null) failures.push("destination_date_invalid");
  if (sourceDate !== null && destinationDate !== null && sourceDate >= destinationDate) {
    failures.push("source_not_earlier");
  }

  return { ok: failures.length === 0, failures };
}

/** Source and destination must be independently opened, separate tabs/windows. */
export function verifySeparateTabs(
  sourceTabId: string | number | null | undefined,
  destinationTabId: string | number | null | undefined
): { ok: boolean; failures: string[] } {
  if (sourceTabId === null || sourceTabId === undefined) return { ok: false, failures: ["source_tab_unknown"] };
  if (destinationTabId === null || destinationTabId === undefined) {
    return { ok: false, failures: ["destination_tab_unknown"] };
  }
  if (sourceTabId === destinationTabId) return { ok: false, failures: ["same_tab"] };
  return { ok: true, failures: [] };
}

/**
 * After navigating to what should be a specific document, independently
 * confirm the observed identity exactly matches what we expected to
 * open — not merely "the tab didn't change." Used post-navigation and
 * again immediately before a draft save.
 */
export function matchesExpectedIdentity(
  observed: Partial<DocumentIdentity>,
  expected: { patient: string; mr: string; form: string; date: string; user: string }
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  if (normalize(observed.patient) !== normalize(expected.patient)) failures.push("patient_mismatch");
  if (normalize(observed.mr) !== normalize(expected.mr)) failures.push("mr_mismatch");
  if (normalize(observed.form) !== normalize(expected.form)) failures.push("form_mismatch");
  // Compared by calendar value, not string equality: an expected date sourced from
  // OCR/CSV or any other non-EHR origin is not guaranteed to share the EHR's exact
  // zero-padding convention, and "7/20/2026" must not be treated as a different date
  // from "07/20/2026".
  const observedDateMs = parseUsDate(observed.date);
  const expectedDateMs = parseUsDate(expected.date);
  if (observedDateMs === null || expectedDateMs === null || observedDateMs !== expectedDateMs) {
    failures.push("date_mismatch");
  }
  if (normalize(observed.author) !== normalize(expected.user)) failures.push("author_mismatch");
  return { ok: failures.length === 0, failures };
}

/**
 * Every configured selector must resolve to exactly one element in its
 * expected context. Zero or multiple matches is always a hard stop —
 * callers must never fall back to positional/first-match selection.
 */
export function requireUniqueMatch(
  matchCount: number,
  selectorDescription: string
): { ok: boolean; failures: string[] } {
  if (matchCount === 1) return { ok: true, failures: [] };
  const kind = matchCount === 0 ? "zero_matches" : "multiple_matches";
  return { ok: false, failures: [`selector_${kind}:${selectorDescription}`] };
}

/**
 * The adapter's recorded layout fingerprint must exactly match what is
 * observed live. Any drift invalidates the adapter for this session.
 */
export function verifyLayoutVersion(
  observedFingerprint: string | null | undefined,
  adapterFingerprint: string | null | undefined
): { ok: boolean; failures: string[] } {
  if (!observedFingerprint) return { ok: false, failures: ["observed_layout_fingerprint_missing"] };
  if (!adapterFingerprint) return { ok: false, failures: ["adapter_layout_fingerprint_missing"] };
  if (observedFingerprint !== adapterFingerprint) return { ok: false, failures: ["layout_drift"] };
  return { ok: true, failures: [] };
}

/** Every allowlist entry must belong to the exact form type/version being processed. */
export function verifyFormVersionAllowlist(
  allowlist: readonly FieldAllowlistEntry[],
  expectedFormType: string,
  expectedFormVersion: string,
  entryFormMeta: (entry: FieldAllowlistEntry) => { formType: string; formVersion: string }
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const entry of allowlist) {
    const meta = entryFormMeta(entry);
    if (normalize(meta.formType) !== normalize(expectedFormType) ||
        normalize(meta.formVersion) !== normalize(expectedFormVersion)) {
      failures.push(`allowlist_entry_wrong_form_version:${entry.key}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

/** Defense-in-depth keyword guard: reject any allowlist entry whose label suggests a prohibited field. */
export function assertFieldNotProhibited(label: string): { ok: boolean; failures: string[] } {
  if (PROHIBITED_FIELD_LABEL_PATTERN.test(normalize(label))) {
    return { ok: false, failures: ["label_suggests_prohibited_field"] };
  }
  if (FINALIZATION_PATTERN.test(normalize(label))) {
    return { ok: false, failures: ["label_suggests_finalization_control"] };
  }
  return { ok: true, failures: [] };
}

export interface SourceControl {
  key: string;
  type: ControlType;
  group?: string;
  checked?: boolean;
  value?: string;
}

export interface DestinationControl {
  key: string;
  type: ControlType;
  group?: string;
  checked?: boolean;
  value?: string;
}

function allowEntry(
  control: SourceControl,
  allowlist: readonly FieldAllowlistEntry[]
): FieldAllowlistEntry | null {
  const entry = allowlist.find((candidate) => normalize(candidate.key) === normalize(control.key));
  if (!entry || entry.type !== control.type) return null;
  return entry;
}

/**
 * Compare source and destination controls against the exact-form-version
 * allowlist and produce an immutable proposal plan. Only controls
 * explicitly present in the allowlist are ever considered; every other
 * source control is silently ignored (T26). Any contradiction, mismatch,
 * or non-allowlisted source value produces an `unresolved` entry instead
 * of a proposal — callers must fail closed on any non-empty `unresolved`.
 */
export function buildPlan(
  sourceControls: readonly SourceControl[],
  destinationControls: readonly DestinationControl[],
  allowlist: readonly FieldAllowlistEntry[]
): ProposalPlan {
  const destinationByKey = new Map(
    destinationControls.map((control) => [normalize(control.key), control])
  );
  const proposals: ProposedChange[] = [];
  const unresolved: { key: string; reason: string }[] = [];

  for (const source of sourceControls) {
    const allowed = allowEntry(source, allowlist);
    if (!allowed) continue; // T26: non-allowlisted controls are ignored, never proposed.

    const destination = destinationByKey.get(normalize(source.key));
    if (!destination || destination.type !== source.type) {
      unresolved.push({ key: source.key, reason: "missing_or_incompatible_destination" });
      continue;
    }

    if (source.type === "checkbox") {
      if (source.checked === true && destination.checked !== true) {
        proposals.push({ key: source.key, type: "checkbox", checked: true });
      }
      continue;
    }

    if (source.type === "radio") {
      if (source.checked !== true) continue;
      const conflicting = destinationControls.some(
        (candidate) =>
          candidate.type === "radio" &&
          normalize(candidate.group) === normalize(source.group) &&
          candidate.checked === true &&
          normalize(candidate.key) !== normalize(source.key)
      );
      if (conflicting) {
        unresolved.push({ key: source.key, reason: "contradictory_destination_radio" });
      } else if (destination.checked !== true) {
        proposals.push({ key: source.key, type: "radio", checked: true });
      }
      continue;
    }

    if (source.type === "select") {
      const allowedSelect = allowed as Extract<FieldAllowlistEntry, { type: "select" }>;
      const sourceValue = normalize(source.value);
      const destinationValue = normalize(destination.value);
      const defaultValue = normalize(allowedSelect.defaultValue);
      if (!sourceValue || sourceValue === defaultValue) continue;
      if (!allowedSelect.allowedValues.map(normalize).includes(sourceValue)) {
        unresolved.push({ key: source.key, reason: "source_value_not_allowlisted" });
      } else if (destinationValue && destinationValue !== defaultValue && destinationValue !== sourceValue) {
        unresolved.push({ key: source.key, reason: "contradictory_destination_select" });
      } else if (destinationValue !== sourceValue) {
        proposals.push({ key: source.key, type: "select", value: sourceValue });
      }
      continue;
    }

    if (source.type === "text") {
      const allowedText = allowed as Extract<FieldAllowlistEntry, { type: "text" }>;
      // Deliberately NOT run through normalize(): the "GA" exception is exact-or-nothing.
      // "GA ", "GA.", "ga", and "General Anesthesia" must all be rejected, so no
      // whitespace-trimming or case-folding may happen before this comparison.
      const sourceValue = source.value ?? "";
      const destinationValue = destination.value ?? "";
      if (allowedText.exactValue !== "GA" || sourceValue !== "GA") continue;
      if (destinationValue && destinationValue !== "GA") {
        unresolved.push({ key: source.key, reason: "contradictory_destination_text" });
      } else if (destinationValue !== "GA") {
        proposals.push({ key: source.key, type: "text", value: "GA" });
      }
    }
  }

  return { proposals, unresolved };
}

/** A plan may only be applied when there is nothing unresolved. */
export function isFailClosed(plan: ProposalPlan): boolean {
  return plan.unresolved.length > 0;
}

export function isFinalizationLabel(label: string): boolean {
  return FINALIZATION_PATTERN.test(normalize(label));
}

/**
 * A Save Draft control's visible label must exactly match the configured
 * save label (case/whitespace-insensitive) and must never also match the
 * finalization pattern — a mislabeled or ambiguous control blocks saving.
 */
export function validateSaveDraftLabel(
  observedLabel: string,
  configuredSaveLabel: string
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  if (isFinalizationLabel(observedLabel)) failures.push("label_matches_finalization_pattern");
  if (normalize(observedLabel).toLowerCase() !== normalize(configuredSaveLabel).toLowerCase()) {
    failures.push("label_does_not_match_configured_save_control");
  }
  return { ok: failures.length === 0, failures };
}

/** Deterministic idempotency key for one save attempt on one page of one queue entry. */
export function computeIdempotencyKey(
  queueEntryId: string,
  pageIndex: number,
  formVersion: string
): string {
  return `${normalize(queueEntryId)}::page-${pageIndex}::${normalize(formVersion)}`;
}

/** Duplicate-save prevention: never re-save (or re-click) an idempotency key that already succeeded. */
export function wasAlreadySaved(
  idempotencyKey: string,
  priorSuccessfulKeys: ReadonlySet<string> | readonly string[]
): boolean {
  const set = priorSuccessfulKeys instanceof Set ? priorSuccessfulKeys : new Set(priorSuccessfulKeys);
  return set.has(idempotencyKey);
}
