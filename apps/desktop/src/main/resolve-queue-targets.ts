/**
 * Turns confirmed WorklistRow records into QueueTargets navigation can
 * act on. OCR only ever extracts patient name, form date, days
 * outstanding, and category (Task 4) — never MR number, since that
 * isn't reliably visible/needed on a worklist photo. MR and the
 * assigned user are resolved here instead: the assigned user is always
 * the RN who's clearing her own queue, and MR is looked up from the
 * synthetic patient directory for Synthetic Development Mode. A real
 * deployment doesn't need this lookup at all — MR/user are simply
 * whatever the matched Pending row itself shows once patient+form+date
 * narrow it down; see docs/KNOWN_LIMITATIONS.md.
 */
import type { WorklistRow } from "@rn-doc-runner/contracts";
import type { QueueTarget } from "@rn-doc-runner/queue-engine";
import { PATIENTS } from "@rn-doc-runner/synthetic-ehr/fixtures";

export interface UnresolvedQueueRow {
  worklistRowId: string;
  reason: string;
}

export interface ResolveQueueTargetsResult {
  targets: QueueTarget[];
  unresolved: UnresolvedQueueRow[];
}

export function resolveQueueTargets(rows: WorklistRow[], expectedAuthor: string): ResolveQueueTargetsResult {
  const targets: QueueTarget[] = [];
  const unresolved: UnresolvedQueueRow[] = [];

  for (const row of rows) {
    // Rows the RN explicitly removed on the Import Review screen (Phase 2 /
    // Task P2-1) are intentionally dropped, not reported as needing attention.
    if (row.removed) continue;
    if (row.duplicateOfRowId) {
      unresolved.push({ worklistRowId: row.id, reason: "duplicate_of_another_row" });
      continue;
    }
    if (!row.formDateNormalized) {
      unresolved.push({ worklistRowId: row.id, reason: "unnormalizable_date" });
      continue;
    }
    if (!row.formCategory) {
      unresolved.push({ worklistRowId: row.id, reason: "form_category_not_identified" });
      continue;
    }
    const patient = PATIENTS.find((p) => p.name.toLowerCase() === row.patientNameRaw.toLowerCase());
    if (!patient) {
      unresolved.push({ worklistRowId: row.id, reason: "patient_not_found_in_directory" });
      continue;
    }
    targets.push({
      queueEntryId: row.id,
      criteria: {
        patient: patient.name,
        mr: patient.mr,
        form: row.formCategory,
        date: row.formDateNormalized,
        user: expectedAuthor
      }
    });
  }

  return { targets, unresolved };
}
