/**
 * Synthetic EHR fixture data. Every patient, MR, name, and date below is
 * fabricated for local testing only — none of it refers to a real person
 * or record. This file must never be edited to contain live PHI.
 */
import type { ControlType } from "@rn-doc-runner/contracts";

export const AUTHORIZED_AUTHOR = "Nurse, Demo (RN)";
export const OTHER_AUTHOR = "Rivera, Jordan (RN)";

export interface FieldControlFixture {
  key: string;
  label: string;
  type: ControlType;
  group?: string;
  options?: string[];
  prohibited?: boolean;
  defaultChecked?: boolean;
  defaultValue?: string;
}

export interface RedLinkRowFixture {
  id: string;
  label: string;
  hiddenInCollapsedGroup?: boolean;
}

export interface RedLinkSectionFixture {
  id: string;
  linkLabel: string;
  modalTitle: string;
  rows: RedLinkRowFixture[];
  discontinuedDateSeed: string;
}

export interface FormPageFixture {
  pageLabel: string;
  pageIndex: number;
  controls: FieldControlFixture[];
  redLinkSections?: RedLinkSectionFixture[];
}

export type DocumentBehaviorFlag =
  | "force_validation_error"
  | "force_session_expired"
  | "layout_drift";

export interface DocumentFixture {
  id: string;
  patientId: string;
  formType: string;
  formVersion: string;
  date: string;
  author: string;
  status: "Pending" | "Draft" | "Completed";
  pages: FormPageFixture[];
  behaviorFlags?: DocumentBehaviorFlag[];
}

export interface EpisodeFixture {
  id: string;
  label: string;
  documentIds: string[];
}

export interface PatientFixture {
  id: string;
  name: string;
  mr: string;
  episodes: EpisodeFixture[];
}

const snvPages = (formVersion: string): FormPageFixture[] => [
  {
    pageLabel: "Page 1",
    pageIndex: 0,
    controls: [
      { key: `${formVersion}::page1::care_plan_reviewed`, label: "Care plan reviewed with patient", type: "checkbox" },
      { key: `${formVersion}::page1::ambulation_status::independent`, label: "Ambulation: Independent", type: "radio", group: "ambulation_status" },
      { key: `${formVersion}::page1::ambulation_status::assist`, label: "Ambulation: Requires assist", type: "radio", group: "ambulation_status" },
      { key: `${formVersion}::page1::visit_frequency`, label: "Visit frequency", type: "select", options: ["", "Weekly", "Biweekly", "Monthly"], defaultValue: "" },
      { key: `${formVersion}::page1::anesthesia_exception`, label: "Anesthesia exception code", type: "text" },
      { key: `${formVersion}::page1::pulse_rate`, label: "Pulse rate (bpm)", type: "text", prohibited: true },
      { key: `${formVersion}::page1::pain_score`, label: "Pain score (0-10)", type: "text", prohibited: true },
      { key: `${formVersion}::page1::wound_length_cm`, label: "Wound length (cm)", type: "text", prohibited: true },
      { key: `${formVersion}::page1::visit_narrative`, label: "Visit narrative", type: "text", prohibited: true }
    ]
  },
  {
    pageLabel: "Page 2",
    pageIndex: 1,
    controls: [
      { key: `${formVersion}::page2::safety_education_provided`, label: "Safety education provided", type: "checkbox" },
      { key: `${formVersion}::page2::goal_status::met`, label: "Goal status: Met", type: "radio", group: "goal_status" },
      { key: `${formVersion}::page2::goal_status::not_met`, label: "Goal status: Not met", type: "radio", group: "goal_status" },
      { key: `${formVersion}::page2::equipment_need`, label: "Equipment need", type: "select", options: ["", "Walker", "Wheelchair", "None"], defaultValue: "" },
      { key: `${formVersion}::page2::wound_measurement_cm`, label: "Wound measurement (cm)", type: "text", prohibited: true },
      { key: `${formVersion}::page2::assessment_narrative`, label: "Assessment narrative", type: "text", prohibited: true }
    ]
  }
];

const medAdminPages = (formVersion: string): FormPageFixture[] => [
  {
    pageLabel: "Page 1",
    pageIndex: 0,
    controls: [
      { key: `${formVersion}::page1::medication_list_reviewed`, label: "Medication list reviewed with patient/caregiver", type: "checkbox" },
      { key: `${formVersion}::page1::visit_setting::home`, label: "Visit setting: Home", type: "radio", group: "visit_setting" },
      { key: `${formVersion}::page1::visit_setting::facility`, label: "Visit setting: Facility", type: "radio", group: "visit_setting" },
      { key: `${formVersion}::page1::next_review_frequency`, label: "Next medication review frequency", type: "select", options: ["", "Weekly", "Biweekly", "Monthly"], defaultValue: "" },
      { key: `${formVersion}::page1::medication_name`, label: "Medication name", type: "text", prohibited: true },
      { key: `${formVersion}::page1::dose_amount`, label: "Dose", type: "text", prohibited: true },
      { key: `${formVersion}::page1::route`, label: "Route", type: "text", prohibited: true },
      { key: `${formVersion}::page1::administration_time`, label: "Administration time", type: "text", prohibited: true },
      { key: `${formVersion}::page1::administration_status`, label: "Administration status", type: "text", prohibited: true }
    ]
  },
  {
    pageLabel: "Page 2",
    pageIndex: 1,
    controls: [
      { key: `${formVersion}::page2::teaching_materials_provided`, label: "Teaching materials provided", type: "checkbox" },
      { key: `${formVersion}::page2::caregiver_competency_verified`, label: "Caregiver competency verified", type: "checkbox" },
      { key: `${formVersion}::page2::adverse_reaction_narrative`, label: "Adverse reaction narrative", type: "text", prohibited: true }
    ]
  }
];

const recertPages = (formVersion: string): FormPageFixture[] => [
  {
    pageLabel: "Page 1",
    pageIndex: 0,
    controls: [
      { key: `${formVersion}::page1::homebound_status_confirmed`, label: "Homebound status confirmed", type: "checkbox" },
      { key: `${formVersion}::page1::certification_period`, label: "Certification period", type: "select", options: ["", "30-day", "60-day"], defaultValue: "" },
      { key: `${formVersion}::page1::recert_narrative`, label: "Recertification narrative", type: "text", prohibited: true }
    ]
  },
  {
    pageLabel: "Plan of Care",
    pageIndex: 1,
    controls: [
      { key: `${formVersion}::poc::plan_reviewed`, label: "Plan of Care reviewed", type: "checkbox" }
    ],
    redLinkSections: [
      {
        id: "diagnoses",
        linkLabel: "Diagnoses",
        modalTitle: "Diagnoses — Batch Update Dates",
        rows: [
          { id: "dx-1", label: "Diagnosis: Hypertension, unspecified" },
          { id: "dx-2", label: "Diagnosis: Type 2 diabetes mellitus" },
          { id: "dx-3", label: "Diagnosis: Chronic kidney disease, stage 3", hiddenInCollapsedGroup: true }
        ],
        discontinuedDateSeed: "12/31/2099"
      },
      {
        id: "orders",
        linkLabel: "Orders",
        modalTitle: "Orders — Batch Update Dates",
        rows: [
          { id: "ord-1", label: "Order: Skilled nursing visits" },
          { id: "ord-2", label: "Order: Home health aide services" }
        ],
        discontinuedDateSeed: "12/31/2099"
      }
    ]
  }
];

function doc(partial: Omit<DocumentFixture, "pages"> & { pages?: FormPageFixture[] }): DocumentFixture {
  const pages =
    partial.pages ??
    (partial.formType === "OASIS/Nurse Recert"
      ? recertPages(partial.formVersion)
      : partial.formType === "Med Admin Skilled Nurse Visit Record"
        ? medAdminPages(partial.formVersion)
        : snvPages(partial.formVersion));
  return { ...partial, pages };
}

export const DOCUMENTS: DocumentFixture[] = [
  // --- Patient 1: clean single-predecessor Skilled Nurse Visit Note path ---
  doc({ id: "doc-a1", patientId: "pat-1", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "06/01/2026", author: AUTHORIZED_AUTHOR, status: "Completed" }),
  doc({ id: "doc-a1-narrative-blocker", patientId: "pat-1", formType: "OASIS/Nurse Recert", formVersion: "RECERT-v1", date: "05/20/2026", author: AUTHORIZED_AUTHOR, status: "Completed" }),
  doc({ id: "doc-a2", patientId: "pat-1", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "07/28/2026", author: AUTHORIZED_AUTHOR, status: "Pending" }),

  // --- Patient 2: OASIS/Nurse Recert with red-link plan-of-care workflow ---
  doc({ id: "doc-b1", patientId: "pat-2", formType: "OASIS/Nurse Recert", formVersion: "RECERT-v1", date: "05/15/2026", author: AUTHORIZED_AUTHOR, status: "Completed" }),
  doc({ id: "doc-b2", patientId: "pat-2", formType: "OASIS/Nurse Recert", formVersion: "RECERT-v1", date: "07/14/2026", author: AUTHORIZED_AUTHOR, status: "Pending" }),

  // --- Patient 3: ambiguous predecessor chronology (two equally-nearest candidates) ---
  doc({ id: "doc-c1a", patientId: "pat-3", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "06/15/2026", author: AUTHORIZED_AUTHOR, status: "Completed" }),
  doc({ id: "doc-c1b", patientId: "pat-3", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "06/15/2026", author: AUTHORIZED_AUTHOR, status: "Completed" }),
  doc({ id: "doc-c2", patientId: "pat-3", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "07/20/2026", author: AUTHORIZED_AUTHOR, status: "Pending" }),

  // --- Patient 4: wrong-author predecessor must be rejected; no qualifying predecessor exists ---
  doc({ id: "doc-d1", patientId: "pat-4", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "06/10/2026", author: OTHER_AUTHOR, status: "Completed" }),
  doc({ id: "doc-d2", patientId: "pat-4", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "07/22/2026", author: AUTHORIZED_AUTHOR, status: "Pending" }),

  // --- Patient 5: predecessor lives in an older episode, not the nearest one ---
  doc({ id: "doc-e1", patientId: "pat-5", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "04/02/2026", author: AUTHORIZED_AUTHOR, status: "Completed" }),
  doc({ id: "doc-e2", patientId: "pat-5", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "07/25/2026", author: AUTHORIZED_AUTHOR, status: "Pending" }),

  // --- Patient 6: unsupported form, no adapter should ever match ---
  doc({
    id: "doc-f1",
    patientId: "pat-6",
    formType: "Wound Care Note",
    formVersion: "WCN-v1",
    date: "07/18/2026",
    author: AUTHORIZED_AUTHOR,
    status: "Pending",
    pages: [{ pageLabel: "Page 1", pageIndex: 0, controls: [{ key: "WCN-v1::page1::narrative", label: "Wound narrative", type: "text", prohibited: true }] }]
  }),

  // --- Patient 7: layout drift on the destination page ---
  doc({ id: "doc-g1", patientId: "pat-7", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "06/05/2026", author: AUTHORIZED_AUTHOR, status: "Completed" }),
  doc({ id: "doc-g2", patientId: "pat-7", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "07/26/2026", author: AUTHORIZED_AUTHOR, status: "Pending", behaviorFlags: ["layout_drift"] }),

  // --- Patient 8: destination save always returns a validation error ---
  doc({ id: "doc-h1", patientId: "pat-8", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "06/08/2026", author: AUTHORIZED_AUTHOR, status: "Completed" }),
  doc({ id: "doc-h2", patientId: "pat-8", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "07/24/2026", author: AUTHORIZED_AUTHOR, status: "Pending", behaviorFlags: ["force_validation_error"] }),

  // --- Patient 9: destination session expires on save ---
  doc({ id: "doc-i1", patientId: "pat-9", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "06/09/2026", author: AUTHORIZED_AUTHOR, status: "Completed" }),
  doc({ id: "doc-i2", patientId: "pat-9", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "07/23/2026", author: AUTHORIZED_AUTHOR, status: "Pending", behaviorFlags: ["force_session_expired"] }),

  // --- Patient 10: two indistinguishable pending rows (identical patient/mr/form/date/user) — navigation must reject the ambiguous match ---
  doc({ id: "doc-j1", patientId: "pat-10", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "07/19/2026", author: AUTHORIZED_AUTHOR, status: "Pending" }),
  doc({ id: "doc-j2", patientId: "pat-10", formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", date: "07/19/2026", author: AUTHORIZED_AUTHOR, status: "Pending" }),

  // --- Patient 11: clean single-predecessor Med Admin Skilled Nurse Visit Record path (third form adapter) ---
  doc({ id: "doc-k1", patientId: "pat-11", formType: "Med Admin Skilled Nurse Visit Record", formVersion: "MEDADMIN-v1", date: "06/12/2026", author: AUTHORIZED_AUTHOR, status: "Completed" }),
  doc({ id: "doc-k2", patientId: "pat-11", formType: "Med Admin Skilled Nurse Visit Record", formVersion: "MEDADMIN-v1", date: "07/29/2026", author: AUTHORIZED_AUTHOR, status: "Pending" })
];

export const PATIENTS: PatientFixture[] = [
  { id: "pat-1", name: "Rehearsal Alpha", mr: "SYN-1001", episodes: [
    { id: "ep-1-1", label: "Episode #1 (current)", documentIds: ["doc-a2"] },
    { id: "ep-1-2", label: "Episode #2 (older)", documentIds: ["doc-a1", "doc-a1-narrative-blocker"] }
  ]},
  { id: "pat-2", name: "Rehearsal Bravo", mr: "SYN-1002", episodes: [
    { id: "ep-2-1", label: "Episode #1 (current)", documentIds: ["doc-b2"] },
    { id: "ep-2-2", label: "Episode #2 (older)", documentIds: ["doc-b1"] }
  ]},
  { id: "pat-3", name: "Rehearsal Charlie", mr: "SYN-1003", episodes: [
    { id: "ep-3-1", label: "Episode #1 (current)", documentIds: ["doc-c2"] },
    { id: "ep-3-2", label: "Episode #2 (older)", documentIds: ["doc-c1a", "doc-c1b"] }
  ]},
  { id: "pat-4", name: "Rehearsal Delta", mr: "SYN-1004", episodes: [
    { id: "ep-4-1", label: "Episode #1 (current)", documentIds: ["doc-d2"] },
    { id: "ep-4-2", label: "Episode #2 (older)", documentIds: ["doc-d1"] }
  ]},
  { id: "pat-5", name: "Rehearsal Echo", mr: "SYN-1005", episodes: [
    { id: "ep-5-1", label: "Episode #1 (current)", documentIds: ["doc-e2"] },
    { id: "ep-5-2", label: "Episode #2 (no qualifying documents)", documentIds: [] },
    { id: "ep-5-3", label: "Episode #3 (oldest)", documentIds: ["doc-e1"] }
  ]},
  { id: "pat-6", name: "Rehearsal Foxtrot", mr: "SYN-1006", episodes: [
    { id: "ep-6-1", label: "Episode #1 (current)", documentIds: ["doc-f1"] }
  ]},
  { id: "pat-7", name: "Rehearsal Golf", mr: "SYN-1007", episodes: [
    { id: "ep-7-1", label: "Episode #1 (current)", documentIds: ["doc-g2"] },
    { id: "ep-7-2", label: "Episode #2 (older)", documentIds: ["doc-g1"] }
  ]},
  { id: "pat-8", name: "Rehearsal Hotel", mr: "SYN-1008", episodes: [
    { id: "ep-8-1", label: "Episode #1 (current)", documentIds: ["doc-h2"] },
    { id: "ep-8-2", label: "Episode #2 (older)", documentIds: ["doc-h1"] }
  ]},
  { id: "pat-9", name: "Rehearsal India", mr: "SYN-1009", episodes: [
    { id: "ep-9-1", label: "Episode #1 (current)", documentIds: ["doc-i2"] },
    { id: "ep-9-2", label: "Episode #2 (older)", documentIds: ["doc-i1"] }
  ]},
  { id: "pat-10", name: "Rehearsal Juliet", mr: "SYN-1010", episodes: [
    { id: "ep-10-1", label: "Episode #1 (current)", documentIds: ["doc-j1", "doc-j2"] }
  ]},
  { id: "pat-11", name: "Rehearsal Kilo", mr: "SYN-1011", episodes: [
    { id: "ep-11-1", label: "Episode #1 (current)", documentIds: ["doc-k2"] },
    { id: "ep-11-2", label: "Episode #2 (older)", documentIds: ["doc-k1"] }
  ]}
];

export function findPatient(patientId: string): PatientFixture | undefined {
  return PATIENTS.find((p) => p.id === patientId);
}

export function findDocument(documentId: string): DocumentFixture | undefined {
  return DOCUMENTS.find((d) => d.id === documentId);
}
