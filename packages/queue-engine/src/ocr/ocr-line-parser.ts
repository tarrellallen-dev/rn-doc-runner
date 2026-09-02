/**
 * Table-row reconstruction from raw OCR text lines (Task 4).
 *
 * Vision does not reliably return one "line" per visual table row: text
 * separated by wide whitespace (as in a plain-text-aligned table) is
 * often segmented into separate observations and returned in
 * column-major reading order (e.g. every row's patient name, then every
 * row's date) rather than row-major order. Relying on Vision's array
 * order — or assuming one OCR line already equals one row — silently
 * scrambles patient/date/category association. Instead, every
 * observation's own bounding box is used to re-cluster fragments that
 * share a Y-coordinate (i.e. sit on the same visual row) BEFORE any
 * date/name/category extraction happens, regardless of what order
 * Vision returned them in.
 *
 * Once reconstructed into rows, each row's merged text is inspected for
 * an embedded date; everything before the date is the patient name, an
 * integer immediately after the date is days outstanding, and any
 * trailing text is checked against known form categories. Rows with no
 * recognizable date are treated as headers/noise and reported as
 * skipped rather than guessed at.
 */
import type { OcrLine } from "./provider.js";
import { parseFlexibleDate } from "./date-normalize.js";

const DATE_PATTERN = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}-\d{1,2}-\d{1,2})/;

export const KNOWN_CATEGORIES = ["Skilled Nurse Visit Note", "OASIS/Nurse Recert", "Med Admin Skilled Nurse Visit Record"];

export interface ExtractedWorklistRow {
  patientNameRaw: string;
  formDateRaw: string;
  formDateNormalized: string | null;
  daysOutstanding?: number;
  formCategory?: string;
  confidence: number;
  /** Which page of a multi-page source document (PDF) this row came from. Undefined for a single-image/CSV import. */
  sourcePageNumber?: number;
}

export interface ExtractionResult {
  rows: ExtractedWorklistRow[];
  skippedLineCount: number;
}

interface ReconstructedRow {
  text: string;
  confidence: number;
}

/**
 * Groups OCR fragments into visual rows by bounding-box Y-coordinate
 * proximity, independent of Vision's reported array order. Falls back
 * to treating each line as its own row when no bounding boxes are
 * available (e.g. a future OCR provider that doesn't report geometry).
 */
export function reconstructRows(lines: OcrLine[]): ReconstructedRow[] {
  const withBoxes = lines.filter((line) => line.boundingBox !== undefined);
  if (withBoxes.length === 0) {
    return lines.map((line) => ({ text: line.text, confidence: line.confidence }));
  }

  const heights = withBoxes.map((line) => line.boundingBox!.height).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 0.05;
  const yTolerance = medianHeight * 0.6;

  // Vision's normalized boundingBox has origin bottom-left, so descending Y is top-to-bottom reading order.
  const sortedByY = [...withBoxes].sort((a, b) => b.boundingBox!.y - a.boundingBox!.y);

  const clusters: OcrLine[][] = [];
  for (const line of sortedByY) {
    const centerY = line.boundingBox!.y + line.boundingBox!.height / 2;
    const currentCluster = clusters[clusters.length - 1];
    const refLine = currentCluster?.[0];
    if (refLine) {
      const refCenterY = refLine.boundingBox!.y + refLine.boundingBox!.height / 2;
      if (Math.abs(centerY - refCenterY) <= yTolerance) {
        currentCluster.push(line);
        continue;
      }
    }
    clusters.push([line]);
  }

  return clusters.map((cluster) => {
    const sortedByX = [...cluster].sort((a, b) => a.boundingBox!.x - b.boundingBox!.x);
    return {
      text: sortedByX.map((l) => l.text).join(" "),
      confidence: cluster.reduce((sum, l) => sum + l.confidence, 0) / cluster.length
    };
  });
}

export function extractWorklistRowsFromOcrLines(lines: OcrLine[], sourcePageNumber?: number): ExtractionResult {
  const reconstructed = reconstructRows(lines);
  const rows: ExtractedWorklistRow[] = [];
  let skippedLineCount = 0;

  for (const row of reconstructed) {
    const dateMatch = row.text.match(DATE_PATTERN);
    if (!dateMatch) {
      skippedLineCount += 1;
      continue;
    }
    const dateRaw = dateMatch[0];
    const before = row.text.slice(0, dateMatch.index).trim().replace(/\s{2,}/g, " ");
    const after = row.text.slice((dateMatch.index ?? 0) + dateRaw.length).trim();
    if (!before) {
      skippedLineCount += 1;
      continue;
    }

    const daysMatch = after.match(/^(\d+)/);
    const daysOutstanding = daysMatch ? Number(daysMatch[1]) : undefined;
    const remainder = daysMatch ? after.slice(daysMatch[0].length).trim() : after;
    const category = KNOWN_CATEGORIES.find((c) => remainder.toLowerCase().includes(c.toLowerCase()));

    rows.push({
      patientNameRaw: before,
      formDateRaw: dateRaw,
      formDateNormalized: parseFlexibleDate(dateRaw),
      daysOutstanding,
      formCategory: category,
      confidence: row.confidence,
      sourcePageNumber
    });
  }

  return { rows, skippedLineCount };
}
