import {
  SiteAdapterSchema,
  FormAdapterSchema,
  CalibrationCandidateSchema,
  type SiteAdapter,
  type FormAdapter,
  type CalibrationCandidate
} from "@rn-doc-runner/contracts";
import type { RawCalibrationExtraction } from "./recorder.js";

export function validateSiteAdapter(data: unknown): SiteAdapter {
  return SiteAdapterSchema.parse(data);
}

export function validateFormAdapter(data: unknown): FormAdapter {
  return FormAdapterSchema.parse(data);
}

export function validateCalibrationCandidate(data: unknown): CalibrationCandidate {
  return CalibrationCandidateSchema.parse(data);
}

export function toCalibrationCandidate(
  raw: RawCalibrationExtraction,
  originVisited: string,
  layoutFingerprint: string,
  id: string
): CalibrationCandidate {
  return validateCalibrationCandidate({
    id,
    capturedAt: new Date().toISOString(),
    originVisited,
    layoutFingerprint,
    candidateSelectors: raw.candidateSelectors,
    zeroMatchWarnings: raw.zeroMatchWarnings,
    multiMatchWarnings: raw.multiMatchWarnings,
    approved: false
  });
}

/** A candidate may only be surfaced for RN/IT review once it has no zero/multi-match selectors. */
export function isCalibrationCandidateReviewReady(candidate: CalibrationCandidate): boolean {
  return candidate.zeroMatchWarnings.length === 0 && candidate.multiMatchWarnings.length === 0;
}

/** An adapter compiled from an approved candidate must still pass full schema validation before install. */
export function validateAdapterForInstall(data: unknown): { ok: true; adapter: SiteAdapter } | { ok: false; failures: string[] } {
  const result = SiteAdapterSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, failures: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  }
  return { ok: true, adapter: result.data };
}
