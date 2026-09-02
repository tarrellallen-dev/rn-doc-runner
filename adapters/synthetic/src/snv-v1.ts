import type { FormAdapter } from "@rn-doc-runner/contracts";
import { controlSelector } from "./selector.js";
import { SYNTHETIC_EHR_LAYOUT_FINGERPRINT } from "./layout-fingerprint.js";

const FORM_TYPE = "Skilled Nurse Visit Note";
const FORM_VERSION = "SNV-v1";

/**
 * Approved field allowlist for Skilled Nurse Visit Note (synthetic).
 * Deliberately excludes every prohibited field defined in the fixture
 * (pulse_rate, pain_score, wound_length_cm, visit_narrative,
 * wound_measurement_cm, assessment_narrative) — those keys must never
 * appear below.
 */
export const SNV_V1_ADAPTER: FormAdapter = {
  formType: FORM_TYPE,
  formVersion: FORM_VERSION,
  layoutFingerprint: SYNTHETIC_EHR_LAYOUT_FINGERPRINT,
  approved: true,
  pages: [
    {
      page: { formType: FORM_TYPE, formVersion: FORM_VERSION, pageLabel: "Page 1", pageIndex: 0 },
      allowlist: [
        {
          key: `${FORM_VERSION}::page1::care_plan_reviewed`,
          selector: controlSelector(`${FORM_VERSION}::page1::care_plan_reviewed`),
          type: "checkbox",
          label: "Care plan reviewed with patient"
        },
        {
          key: `${FORM_VERSION}::page1::ambulation_status::independent`,
          selector: controlSelector(`${FORM_VERSION}::page1::ambulation_status::independent`),
          type: "radio",
          group: "ambulation_status",
          label: "Ambulation: Independent"
        },
        {
          key: `${FORM_VERSION}::page1::ambulation_status::assist`,
          selector: controlSelector(`${FORM_VERSION}::page1::ambulation_status::assist`),
          type: "radio",
          group: "ambulation_status",
          label: "Ambulation: Requires assist"
        },
        {
          key: `${FORM_VERSION}::page1::visit_frequency`,
          selector: controlSelector(`${FORM_VERSION}::page1::visit_frequency`),
          type: "select",
          label: "Visit frequency",
          defaultValue: "",
          allowedValues: ["Weekly", "Biweekly", "Monthly"],
          expectedOptions: ["", "Weekly", "Biweekly", "Monthly"]
        },
        {
          key: `${FORM_VERSION}::page1::anesthesia_exception`,
          selector: controlSelector(`${FORM_VERSION}::page1::anesthesia_exception`),
          type: "text",
          label: "Anesthesia exception code",
          exactValue: "GA"
        }
      ]
    },
    {
      page: { formType: FORM_TYPE, formVersion: FORM_VERSION, pageLabel: "Page 2", pageIndex: 1 },
      allowlist: [
        {
          key: `${FORM_VERSION}::page2::safety_education_provided`,
          selector: controlSelector(`${FORM_VERSION}::page2::safety_education_provided`),
          type: "checkbox",
          label: "Safety education provided"
        },
        {
          key: `${FORM_VERSION}::page2::goal_status::met`,
          selector: controlSelector(`${FORM_VERSION}::page2::goal_status::met`),
          type: "radio",
          group: "goal_status",
          label: "Goal status: Met"
        },
        {
          key: `${FORM_VERSION}::page2::goal_status::not_met`,
          selector: controlSelector(`${FORM_VERSION}::page2::goal_status::not_met`),
          type: "radio",
          group: "goal_status",
          label: "Goal status: Not met"
        },
        {
          key: `${FORM_VERSION}::page2::equipment_need`,
          selector: controlSelector(`${FORM_VERSION}::page2::equipment_need`),
          type: "select",
          label: "Equipment need",
          defaultValue: "",
          allowedValues: ["Walker", "Wheelchair", "None"],
          expectedOptions: ["", "Walker", "Wheelchair", "None"]
        }
      ]
    }
  ]
};
