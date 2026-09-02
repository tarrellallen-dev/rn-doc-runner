/**
 * Current-document navigation (Task 7): Home -> Pending -> exact row ->
 * open the verified form, then independently re-verify identity after
 * navigation. No arbitrary clicking or coordinate-based navigation —
 * every step is an explicit URL transition or an exact-selector lookup.
 */
import type { Page } from "playwright";
import * as rules from "@rn-doc-runner/rules";

export interface PendingRowCriteria {
  patient: string;
  mr: string;
  form: string;
  date: string;
  user: string;
}

export interface RawPendingMatch {
  documentId: string;
  href: string;
}

/** Runs in-page. Flat/no nested named helpers — see form-engine/dom-reader.ts for why. */
export const findPendingRowsInPage = (criteria: PendingRowCriteria): { matches: RawPendingMatch[] } => {
  const matches: RawPendingMatch[] = [];
  const rows = document.querySelectorAll("#rn-pending-table tbody tr");
  rows.forEach((row) => {
    if (
      row.getAttribute("data-patient") === criteria.patient &&
      row.getAttribute("data-mr") === criteria.mr &&
      row.getAttribute("data-form") === criteria.form &&
      row.getAttribute("data-date") === criteria.date &&
      row.getAttribute("data-user") === criteria.user
    ) {
      const link = row.querySelector("[data-open-document]");
      const documentId = row.getAttribute("data-document-id");
      const href = link?.getAttribute("href");
      if (documentId && href) matches.push({ documentId, href });
    }
  });
  return { matches };
};

export interface NavigationResult {
  ok: boolean;
  failures: string[];
  documentId?: string;
  href?: string;
}

export async function openHome(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl);
}

export async function openPending(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/pending`);
}

/**
 * Task 7, steps 1-6: return Home, open Pending, find the exact row, and
 * reject duplicate/ambiguous matches. Does NOT open the document — the
 * caller opens it only after this returns exactly one match, then must
 * independently re-verify identity (step 7) via
 * @rn-doc-runner/form-engine's `readIdentity`.
 */
export async function findExactPendingRow(page: Page, baseUrl: string, criteria: PendingRowCriteria): Promise<NavigationResult> {
  await openPending(page, baseUrl);
  const result = await page.evaluate(findPendingRowsInPage, criteria);
  if (result.matches.length === 0) return { ok: false, failures: ["pending_row_not_found"] };
  if (result.matches.length > 1) return { ok: false, failures: ["pending_row_ambiguous"] };
  const match = result.matches[0]!;
  return { ok: true, failures: [], documentId: match.documentId, href: match.href };
}

export async function openVerifiedForm(page: Page, baseUrl: string, href: string): Promise<void> {
  await page.goto(href.startsWith("http") ? href : `${baseUrl}${href}`);
}

/**
 * Task 7, step 7: after navigation, independently re-read identity and
 * confirm it exactly matches what we expected to open — not merely
 * "the same tab as before we clicked." Re-exported from
 * @rn-doc-runner/rules so both navigation and the Draft Save Adapter
 * (which re-checks this immediately before saving) share one
 * implementation.
 */
export const matchesExpectedIdentity = rules.matchesExpectedIdentity;
