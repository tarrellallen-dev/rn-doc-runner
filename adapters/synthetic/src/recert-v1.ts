import type { FormAdapter } from "@rn-doc-runner/contracts";
import { controlSelector } from "./selector.js";
import { SYNTHETIC_EHR_LAYOUT_FINGERPRINT } from "./layout-fingerprint.js";

const FORM_TYPE = "OASIS/Nurse Recert";
const FORM_VERSION = "RECERT-v1";

/**
 * Approved field allowlist for OASIS/Nurse Recert (synthetic). Excludes
 * recert_narrative. Plan of Care red-link date updates are handled by the
 * dedicated red-link adapter (M14), not this generic field allowlist.
 */
export const RECERT_V1_ADAPTER: FormAdapter = {
  formType: FORM_TYPE,
  formVersion: FORM_VERSION,
  layoutFingerprint: SYNTHETIC_EHR_LAYOUT_FINGERPRINT,
  approved: true,
  pages: [
    {
      page: { formType: FORM_TYPE, formVersion: FORM_VERSION, pageLabel: "Page 1", pageIndex: 0 },
      allowlist: [
        {
          key: `${FORM_VERSION}::page1::homebound_status_confirmed`,
          selector: controlSelector(`${FORM_VERSION}::page1::homebound_status_confirmed`),
          type: "checkbox",
          label: "Homebound status confirmed"
        },
        {
          key: `${FORM_VERSION}::page1::certification_period`,
          selector: controlSelector(`${FORM_VERSION}::page1::certification_period`),
          type: "select",
          label: "Certification period",
          defaultValue: "",
          allowedValues: ["30-day", "60-day"],
          expectedOptions: ["", "30-day", "60-day"]
        }
      ]
    },
    {
      page: { formType: FORM_TYPE, formVersion: FORM_VERSION, pageLabel: "Plan of Care", pageIndex: 1 },
      allowlist: [
        {
          key: `${FORM_VERSION}::poc::plan_reviewed`,
          selector: controlSelector(`${FORM_VERSION}::poc::plan_reviewed`),
          type: "checkbox",
          label: "Plan of Care reviewed"
        }
      ]
    }
  ]
};

export const RECERT_V1_RED_LINK_SECTIONS = [
  { id: "diagnoses", linkSelector: "#redlink-diagnoses-open" },
  { id: "orders", linkSelector: "#redlink-orders-open" }
] as const;

/**
 * Concrete, tested selector configuration for each synthetic red-link
 * section. One entry per section — never shared/generalized. Every
 * clicked control carries the exact label it is expected to show:
 * `completeRedLinkSection` verifies each one against the live DOM and
 * refuses to activate a control whose label or accessible name reads as
 * a finalization action, so a selector that drifts onto Sign/Submit is
 * caught here rather than clicked.
 */
function redLinkSectionConfig(sectionId: string, hasCollapsedGroup: boolean, linkLabel: string) {
  return {
    sectionId,
    openLinkSelector: `#redlink-${sectionId}-open`,
    openLinkLabel: linkLabel,
    modalSelector: `#redlink-${sectionId}-modal`,
    selectAllSelector: `#redlink-${sectionId}-select-all`,
    // Bare checkbox input: its name is on the wrapping <label>, so the element itself has no text.
    selectAllLabel: "",
    rowSelector: `#redlink-${sectionId}-modal .redlink-row`,
    collapsedGroupSelector: hasCollapsedGroup ? `#redlink-${sectionId}-collapsed-group` : undefined,
    batchUpdateDatesButtonSelector: `#redlink-${sectionId}-batch-update-dates`,
    batchUpdateDatesButtonLabel: "Batch Update Dates",
    startEffectiveDateInputSelector: `#redlink-${sectionId}-start-effective-date`,
    discontinuedDateInputSelector: `#redlink-${sectionId}-discontinued-date`,
    updateButtonSelector: `#redlink-${sectionId}-update`,
    updateButtonLabel: "Update",
    insertButtonSelector: `#redlink-${sectionId}-insert`,
    insertButtonLabel: "Insert to Form",
    statusFieldSelector: `#redlink-${sectionId}-status-field`,
    errorSelector: `#redlink-${sectionId}-error`
  };
}

export const RECERT_V1_RED_LINK_CONFIGS = [
  redLinkSectionConfig("diagnoses", true, "Diagnoses"),
  redLinkSectionConfig("orders", false, "Orders")
];
