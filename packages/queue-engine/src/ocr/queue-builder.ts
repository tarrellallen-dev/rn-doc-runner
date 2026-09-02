/**
 * Turns extracted/CSV rows into validated WorklistRow records (Task 4):
 * duplicate detection, confidence scoring passthrough, and both
 * priority (days-outstanding descending) and original-order sorting.
 */
import { WorklistRowSchema, type WorklistRow } from "@rn-doc-runner/contracts";

export interface NormalizedRowInput {
  patientNameRaw: string;
  formDateRaw: string;
  formDateNormalized: string | null;
  daysOutstanding?: number;
  formCategory?: string;
  confidence: number;
  sourcePageNumber?: number;
}

function normalizeKey(row: Pick<WorklistRow, "patientNameRaw" | "formDateNormalized" | "formDateRaw" | "formCategory">): string {
  return `${row.patientNameRaw.toLowerCase().trim()}::${row.formDateNormalized ?? row.formDateRaw}::${(row.formCategory ?? "").toLowerCase()}`;
}

/** Marks every row after the first with the same patient/date/category as a duplicate of the first. */
export function markDuplicates(rows: WorklistRow[]): WorklistRow[] {
  const firstSeenId = new Map<string, string>();
  return rows.map((row) => {
    const key = normalizeKey(row);
    const first = firstSeenId.get(key);
    if (first) return { ...row, duplicateOfRowId: first };
    firstSeenId.set(key, row.id);
    return row;
  });
}

export function buildWorklistRows(inputs: NormalizedRowInput[], importId: string, sourceFileId: string): WorklistRow[] {
  const rows = inputs.map((input, index) =>
    WorklistRowSchema.parse({
      id: `${importId}-row-${index}`,
      importId,
      sourceFileId,
      patientNameRaw: input.patientNameRaw,
      formDateRaw: input.formDateRaw,
      formDateNormalized: input.formDateNormalized ?? undefined,
      daysOutstanding: input.daysOutstanding,
      formCategory: input.formCategory,
      confidence: input.confidence,
      rotationCorrected: false,
      manuallyCorrected: false,
      sourcePageNumber: input.sourcePageNumber,
      rowOrder: index
    })
  );
  return markDuplicates(rows);
}

export function sortByDaysOutstandingDescending(rows: WorklistRow[]): WorklistRow[] {
  return [...rows].sort((a, b) => (b.daysOutstanding ?? -1) - (a.daysOutstanding ?? -1));
}

export function sortOriginalOrder(rows: WorklistRow[]): WorklistRow[] {
  return [...rows].sort((a, b) => a.rowOrder - b.rowOrder);
}
