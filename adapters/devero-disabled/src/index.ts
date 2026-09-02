/**
 * FAIL-CLOSED real Devero adapter.
 *
 * This ships intentionally UNCONFIGURED. Selectors here must never be
 * guessed or inferred — they may only be populated from a sanitized DOM
 * contract produced by Calibration Mode against a facility-approved
 * training tenant, reviewed by RN/IT, and approved per
 * docs/DEPLOYMENT_CHECKLIST.md and the RN DOC OS deployment gate.
 *
 * Do not set `enabled: true` or change `status` away from "UNCONFIGURED"
 * outside of that reviewed, versioned process. Production Draft Mode
 * refuses to load any adapter that is not enabled + APPROVED.
 */
import { validateSiteAdapter } from "@rn-doc-runner/adapter-schema";
import type { SiteAdapter } from "@rn-doc-runner/contracts";

export const DEVERO_SITE_ADAPTER: SiteAdapter = validateSiteAdapter({
  enabled: false,
  status: "UNCONFIGURED",
  adapterVersion: "UNCONFIGURED",
  expectedOrigin: "https://REPLACE_WITH_APPROVED_TENANT_ORIGIN.example",
  expectedAuthor: "Nurse, Demo (RN)",
  identitySelectors: {
    patient: "",
    mr: "",
    form: "",
    date: "",
    author: "",
    page: ""
  },
  allowlist: []
});
