import type { SiteAdapter } from "@rn-doc-runner/contracts";
import { validateSiteAdapter } from "@rn-doc-runner/adapter-schema";
import { STANDARD_IDENTITY_SELECTORS, SYNTHETIC_EHR_LAYOUT_FINGERPRINT } from "./layout-fingerprint.js";
import { SNV_V1_ADAPTER } from "./snv-v1.js";
import { RECERT_V1_ADAPTER } from "./recert-v1.js";
import { MED_ADMIN_V1_ADAPTER } from "./med-admin-v1.js";

/**
 * Synthetic Development Mode site adapter: enabled and approved, but
 * scoped to `http://localhost:4173` only (the local synthetic EHR).
 * `allowlist` here is the union of every approved synthetic form-version
 * allowlist, kept only to satisfy "an enabled adapter has a non-empty
 * allowlist" and for documentation/audit purposes — every actual DOM
 * comparison uses the narrower per-page allowlist selected by
 * @rn-doc-runner/form-engine, never this union directly.
 */
export const SYNTHETIC_SITE_ADAPTER: SiteAdapter = validateSiteAdapter({
  enabled: true,
  status: "APPROVED",
  adapterVersion: "synthetic-v1",
  layoutFingerprint: SYNTHETIC_EHR_LAYOUT_FINGERPRINT,
  expectedOrigin: "http://localhost:4173",
  expectedAuthor: "Nurse, Demo (RN)",
  identitySelectors: STANDARD_IDENTITY_SELECTORS,
  allowlist: [
    ...SNV_V1_ADAPTER.pages.flatMap((p) => p.allowlist),
    ...RECERT_V1_ADAPTER.pages.flatMap((p) => p.allowlist),
    ...MED_ADMIN_V1_ADAPTER.pages.flatMap((p) => p.allowlist)
  ]
});
