export const SYNTHETIC_EHR_LAYOUT_FINGERPRINT = "synthetic-ehr-v1";
export const SYNTHETIC_EHR_DRIFTED_LAYOUT_FINGERPRINT = "synthetic-ehr-v1-drifted";

export const STANDARD_IDENTITY_SELECTORS = {
  patient: "#rn-identity-patient",
  mr: "#rn-identity-mr",
  form: "#rn-identity-form",
  date: "#rn-identity-date",
  author: "#rn-identity-author",
  page: "#rn-identity-page"
} as const;

export const DRIFTED_IDENTITY_SELECTORS = {
  patient: "#rn-identity-patient-drift-v2",
  mr: "#rn-identity-mr-drift-v2",
  form: "#rn-identity-form-drift-v2",
  date: "#rn-identity-date-drift-v2",
  author: "#rn-identity-author-drift-v2",
  page: "#rn-identity-page-drift-v2"
} as const;
