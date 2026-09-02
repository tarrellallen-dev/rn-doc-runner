/**
 * Lenient date normalization for OCR/CSV worklist ingestion — distinct
 * from @rn-doc-runner/rules `parseUsDate`, which stays strict M/D/YYYY
 * (accepting either zero-padded or bare digits) for the safety-critical
 * live-EHR identity comparison. Worklist dates come from noisy
 * photographs and spreadsheets, so this accepts a few common written
 * forms and always normalizes to zero-padded MM/DD/YYYY — matching the
 * EHR's own rendered date format exactly, since downstream code (finding
 * the exact Pending row by an equality match on its displayed date)
 * compares this string literally, not as a parsed calendar value.
 */
import { parseUsDate } from "@rn-doc-runner/rules";

const SLASH_OR_DASH = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/;
const ISO_LIKE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toStrictUs(month: number, day: number, year: number): string | null {
  const candidate = `${pad2(month)}/${pad2(day)}/${year}`;
  return parseUsDate(candidate) !== null ? candidate : null;
}

/** Returns a zero-padded MM/DD/YYYY string, or null if the input cannot be confidently parsed as a calendar date. */
export function parseFlexibleDate(raw: string): string | null {
  const trimmed = raw.trim();

  const slashOrDash = trimmed.match(SLASH_OR_DASH);
  if (slashOrDash) {
    return toStrictUs(Number(slashOrDash[1]), Number(slashOrDash[2]), Number(slashOrDash[3]));
  }

  const iso = trimmed.match(ISO_LIKE);
  if (iso) {
    return toStrictUs(Number(iso[2]), Number(iso[3]), Number(iso[1]));
  }

  return null;
}
