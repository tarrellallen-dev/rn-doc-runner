import { DOCUMENTS, type DocumentFixture, type FieldControlFixture } from "./fixtures.js";

export interface ControlState {
  checked?: boolean;
  value?: string;
}

export interface DocumentRuntimeState {
  controls: Record<string, ControlState>;
  redLinkSectionStatus: Record<string, "incomplete" | "complete">;
  redLinkSelectedRows: Record<string, Set<string>>;
  saveCount: number;
  successfulSaveIdempotencyKeys: Set<string>;
  savedPages: Set<number>;
  sessionExpired: boolean;
  status: DocumentFixture["status"];
}

/** Seed values for source ("Completed") documents used to exercise carry-forward. Synthetic only. */
const SEED_VALUES: Record<string, Record<string, ControlState>> = {
  "doc-a1": {
    "SNV-v1::page1::care_plan_reviewed": { checked: true },
    "SNV-v1::page1::ambulation_status::independent": { checked: true },
    "SNV-v1::page1::visit_frequency": { value: "Weekly" },
    "SNV-v1::page1::anesthesia_exception": { value: "GA" },
    "SNV-v1::page2::safety_education_provided": { checked: true },
    "SNV-v1::page2::goal_status::met": { checked: true },
    "SNV-v1::page2::equipment_need": { value: "Walker" }
  },
  "doc-b1": {
    "RECERT-v1::page1::homebound_status_confirmed": { checked: true },
    "RECERT-v1::page1::certification_period": { value: "60-day" },
    "RECERT-v1::poc::plan_reviewed": { checked: true }
  },
  "doc-e1": {
    "SNV-v1::page1::care_plan_reviewed": { checked: true },
    "SNV-v1::page1::visit_frequency": { value: "Monthly" }
  },
  "doc-g1": {
    "SNV-v1::page1::care_plan_reviewed": { checked: true }
  },
  "doc-h1": {
    "SNV-v1::page1::care_plan_reviewed": { checked: true }
  },
  "doc-i1": {
    "SNV-v1::page1::care_plan_reviewed": { checked: true }
  },
  "doc-k1": {
    "MEDADMIN-v1::page1::medication_list_reviewed": { checked: true },
    "MEDADMIN-v1::page1::visit_setting::home": { checked: true },
    "MEDADMIN-v1::page1::next_review_frequency": { value: "Monthly" },
    "MEDADMIN-v1::page2::teaching_materials_provided": { checked: true },
    "MEDADMIN-v1::page2::caregiver_competency_verified": { checked: true }
  }
};

function defaultControlState(control: FieldControlFixture): ControlState {
  if (control.type === "checkbox" || control.type === "radio") return { checked: false };
  return { value: "" };
}

function buildInitialState(documentFixture: DocumentFixture): DocumentRuntimeState {
  const controls: Record<string, ControlState> = {};
  for (const page of documentFixture.pages) {
    for (const control of page.controls) {
      controls[control.key] = { ...defaultControlState(control), ...SEED_VALUES[documentFixture.id]?.[control.key] };
    }
  }
  const redLinkSectionStatus: Record<string, "incomplete" | "complete"> = {};
  const redLinkSelectedRows: Record<string, Set<string>> = {};
  for (const page of documentFixture.pages) {
    for (const section of page.redLinkSections ?? []) {
      redLinkSectionStatus[section.id] = "incomplete";
      redLinkSelectedRows[section.id] = new Set();
    }
  }
  return {
    controls,
    redLinkSectionStatus,
    redLinkSelectedRows,
    saveCount: 0,
    successfulSaveIdempotencyKeys: new Set(),
    savedPages: new Set(),
    sessionExpired: false,
    status: documentFixture.status
  };
}

let store = new Map<string, DocumentRuntimeState>();

export function resetState(): void {
  store = new Map(DOCUMENTS.map((d) => [d.id, buildInitialState(d)]));
}
resetState();

export function getDocumentState(documentId: string): DocumentRuntimeState | undefined {
  return store.get(documentId);
}
