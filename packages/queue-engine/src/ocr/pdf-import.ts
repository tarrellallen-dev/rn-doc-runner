/**
 * Multi-page PDF worklist import (Phase 2 / Task 4 extension). Every
 * page is OCR'd on-device, in order; every resulting row carries the
 * exact page it came from. Fails safely (returns `ok:false` with a
 * nonclinical error code) on an encrypted, corrupted, unreadable, or
 * zero-page PDF instead of throwing or guessing.
 */
import type { PdfOcrProvider } from "./provider.js";
import { extractWorklistRowsFromOcrLines } from "./ocr-line-parser.js";
import { buildWorklistRows, type NormalizedRowInput } from "./queue-builder.js";
import type { WorklistRow } from "@rn-doc-runner/contracts";

export interface PdfImportResult {
  ok: boolean;
  rows: WorklistRow[];
  pageCount: number;
  skippedLineCount: number;
  error?: string;
}

export async function importWorklistFromPdf(
  provider: PdfOcrProvider,
  pdfPath: string,
  importId: string,
  sourceFileId: string
): Promise<PdfImportResult> {
  const pdfResult = await provider.recognizePdf(pdfPath);
  if (!pdfResult.ok) {
    return { ok: false, rows: [], pageCount: 0, skippedLineCount: 0, error: pdfResult.error ?? "recognize_pdf_failed" };
  }

  const allInputs: NormalizedRowInput[] = [];
  let skippedLineCount = 0;

  // Pages are processed strictly in the order the PDF itself reports them.
  const orderedPages = [...pdfResult.pages].sort((a, b) => a.pageNumber - b.pageNumber);
  for (const page of orderedPages) {
    const extraction = extractWorklistRowsFromOcrLines(page.lines, page.pageNumber);
    skippedLineCount += extraction.skippedLineCount;
    allInputs.push(...extraction.rows);
  }

  const rows = buildWorklistRows(allInputs, importId, sourceFileId);
  return { ok: true, rows, pageCount: pdfResult.pageCount, skippedLineCount };
}
