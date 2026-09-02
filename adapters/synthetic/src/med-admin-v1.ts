import type { FormAdapter } from "@rn-doc-runner/contracts";
import { controlSelector } from "./selector.js";
import { SYNTHETIC_EHR_LAYOUT_FINGERPRINT } from "./layout-fingerprint.js";

const FORM_TYPE = "Med Admin Skilled Nurse Visit Record";
const FORM_VERSION = "MEDADMIN-v1";

/**
 * Approved field allowlist for Med Admin Skilled Nurse Visit Record
 * (synthetic), following RN DOC OS WF-003
 * (`04_WORKFLOWS/WF_MED_ADMIN.md`): only explicitly approved repeatable
 * nonclinical controls may be selected. Medication names, doses,
 * routes, administration times, administration status, reactions, and
 * any related clinical text require current RN confirmation and are
 * never carried forward — deliberately excluded from this allowlist
 * (the fixture's prohibited counterparts are `medication_name`,
 * `dose_amount`, `route`, `administration_time`, `administration_status`,
 * and `adverse_reaction_narrative`; none of those keys may appear below).
 */
export const MED_ADMIN_V1_ADAPTER: FormAdapter = {
  formType: FORM_TYPE,
  formVersion: FORM_VERSION,
  layoutFingerprint: SYNTHETIC_EHR_LAYOUT_FINGERPRINT,
  approved: true,
  pages: [
    {
      page: { formType: FORM_TYPE, formVersion: FORM_VERSION, pageLabel: "Page 1", pageIndex: 0 },
      allowlist: [
        {
          key: `${FORM_VERSION}::page1::medication_list_reviewed`,
          selector: controlSelector(`${FORM_VERSION}::page1::medication_list_reviewed`),
          type: "checkbox",
          label: "Medication list reviewed with patient/caregiver"
        },
        {
          key: `${FORM_VERSION}::page1::visit_setting::home`,
          selector: controlSelector(`${FORM_VERSION}::page1::visit_setting::home`),
          type: "radio",
          group: "visit_setting",
          label: "Visit setting: Home"
        },
        {
          key: `${FORM_VERSION}::page1::visit_setting::facility`,
          selector: controlSelector(`${FORM_VERSION}::page1::visit_setting::facility`),
          type: "radio",
          group: "visit_setting",
          label: "Visit setting: Facility"
        },
        {
          key: `${FORM_VERSION}::page1::next_review_frequency`,
          selector: controlSelector(`${FORM_VERSION}::page1::next_review_frequency`),
          type: "select",
          label: "Next medication review frequency",
          defaultValue: "",
          allowedValues: ["Weekly", "Biweekly", "Monthly"],
          expectedOptions: ["", "Weekly", "Biweekly", "Monthly"]
        }
      ]
    },
    {
      page: { formType: FORM_TYPE, formVersion: FORM_VERSION, pageLabel: "Page 2", pageIndex: 1 },
      allowlist: [
        {
          key: `${FORM_VERSION}::page2::teaching_materials_provided`,
          selector: controlSelector(`${FORM_VERSION}::page2::teaching_materials_provided`),
          type: "checkbox",
          label: "Teaching materials provided"
        },
        {
          key: `${FORM_VERSION}::page2::caregiver_competency_verified`,
          selector: controlSelector(`${FORM_VERSION}::page2::caregiver_competency_verified`),
          type: "checkbox",
          label: "Caregiver competency verified"
        }
      ]
    }
  ]
};
