/**
 * Predecessor discovery (Task 8 / WF_RECERT_EPISODE_SEARCH,
 * WF_GENERIC_CARRY_FORWARD). Searches the Patient Chart in reverse
 * chronological episode order, requires the exact same form type, an
 * earlier date, and the exact authorized source author, and rejects
 * ambiguous chronology rather than guessing.
 */
import type { Page } from "playwright";
import * as rules from "@rn-doc-runner/rules";

export interface ChartDocumentRow {
  documentId: string;
  form: string;
  date: string;
  author: string;
  status: string;
}

export interface ChartEpisode {
  episodeId: string;
  label: string;
  rows: ChartDocumentRow[];
}

/** Runs in-page. Flat/no nested named helpers. Reads chart structure only — never touches identity headers. */
export const readChartEpisodesInPage = (): { episodes: ChartEpisode[] } => {
  const episodes: ChartEpisode[] = [];
  document.querySelectorAll(".episode-folder").forEach((el) => {
    const rows: ChartDocumentRow[] = [];
    el.querySelectorAll("tbody tr[data-document-id]").forEach((row) => {
      const documentId = row.getAttribute("data-document-id");
      const form = row.getAttribute("data-form");
      const date = row.getAttribute("data-date");
      const author = row.getAttribute("data-user");
      const status = row.getAttribute("data-status");
      if (documentId && form && date && author && status) {
        rows.push({ documentId, form, date, author, status });
      }
    });
    episodes.push({
      episodeId: el.getAttribute("data-episode-id") ?? "",
      label: el.querySelector("summary")?.textContent?.trim() ?? "",
      rows
    });
  });
  return { episodes };
};

export interface PredecessorCriteria {
  formType: string;
  expectedAuthor: string;
  destinationDateMs: number;
}

export interface PredecessorSelection {
  ok: boolean;
  failures: string[];
  documentId?: string;
}

/**
 * Pure selection algorithm, independently testable without a browser.
 * Scans every episode (not just the nearest one — WF_RECERT_EPISODE_SEARCH
 * explicitly requires traversing older episodes), keeps only same-exact-
 * form-type, exact-author, strictly-earlier-date candidates, and picks
 * the single nearest (latest still-earlier) one. Two candidates tied for
 * nearest is ambiguous chronology and fails closed rather than picking
 * either arbitrarily.
 */
export function selectNearestQualifyingPredecessor(episodes: ChartEpisode[], criteria: PredecessorCriteria): PredecessorSelection {
  const candidates: { documentId: string; dateMs: number }[] = [];
  for (const episode of episodes) {
    for (const row of episode.rows) {
      if (rules.normalize(row.form) !== rules.normalize(criteria.formType)) continue;
      if (rules.normalize(row.author) !== rules.normalize(criteria.expectedAuthor)) continue;
      const dateMs = rules.parseUsDate(row.date);
      if (dateMs === null) continue;
      if (dateMs >= criteria.destinationDateMs) continue;
      candidates.push({ documentId: row.documentId, dateMs });
    }
  }
  if (candidates.length === 0) return { ok: false, failures: ["no_qualifying_predecessor"] };
  const nearestDateMs = Math.max(...candidates.map((c) => c.dateMs));
  const nearest = candidates.filter((c) => c.dateMs === nearestDateMs);
  if (nearest.length > 1) return { ok: false, failures: ["ambiguous_predecessor_chronology"] };
  return { ok: true, failures: [], documentId: nearest[0]!.documentId };
}

/** Opens every episode's collapsed <details> folder before reading, matching "open each episode and inspect" in the spec. */
export async function expandAllEpisodes(chartPage: Page): Promise<void> {
  await chartPage.evaluate(() => {
    document.querySelectorAll("details.episode-folder").forEach((el) => {
      (el as HTMLDetailsElement).open = true;
    });
  });
}

export async function openPatientChart(chartPage: Page, baseUrl: string, patientId: string): Promise<void> {
  await chartPage.goto(`${baseUrl}/patients/${patientId}/chart`);
}

/** Task 8, steps 1-9: open the chart, expand episodes, and select the nearest qualifying predecessor. */
export async function findPredecessor(
  chartPage: Page,
  baseUrl: string,
  patientId: string,
  criteria: PredecessorCriteria
): Promise<PredecessorSelection> {
  await openPatientChart(chartPage, baseUrl, patientId);
  await expandAllEpisodes(chartPage);
  const { episodes } = await chartPage.evaluate(readChartEpisodesInPage);
  return selectNearestQualifyingPredecessor(episodes, criteria);
}
