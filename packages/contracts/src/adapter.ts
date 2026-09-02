import { z } from "zod";
import { FieldAllowlistEntrySchema } from "./form.js";

export const AdapterStatusSchema = z.enum([
  "UNCONFIGURED",
  "CALIBRATION_CANDIDATE",
  "PENDING_RN_APPROVAL",
  "APPROVED",
  "INVALIDATED"
]);
export type AdapterStatus = z.infer<typeof AdapterStatusSchema>;

export const IdentitySelectorsSchema = z.object({
  patient: z.string(),
  mr: z.string(),
  form: z.string(),
  date: z.string(),
  author: z.string(),
  page: z.string()
});
export type IdentitySelectors = z.infer<typeof IdentitySelectorsSchema>;

/**
 * A site adapter: the patient-free DOM contract for one EHR origin.
 * Ships with enabled:false / status:UNCONFIGURED and must never contain
 * live selectors until every DEPLOYMENT_GATE.md item passes.
 */
export const SiteAdapterSchema = z.object({
  enabled: z.boolean(),
  status: AdapterStatusSchema,
  adapterVersion: z.string().min(1),
  layoutFingerprint: z.string().optional(),
  expectedOrigin: z.string().url(),
  expectedAuthor: z.string().min(1),
  identitySelectors: IdentitySelectorsSchema,
  allowlist: z.array(FieldAllowlistEntrySchema)
}).superRefine((adapter, ctx) => {
  if (adapter.enabled && adapter.status !== "APPROVED") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "an adapter may only be enabled once its status is APPROVED"
    });
  }
  if (adapter.enabled) {
    for (const [field, selector] of Object.entries(adapter.identitySelectors)) {
      if (!selector) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `identity selector missing for ${field}`,
          path: ["identitySelectors", field]
        });
      }
    }
    if (adapter.allowlist.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "an enabled adapter must have a non-empty allowlist",
        path: ["allowlist"]
      });
    }
  }
});
export type SiteAdapter = z.infer<typeof SiteAdapterSchema>;

/** A structural-only candidate produced by the Calibration Mode recorder. Never contains values. */
export const CalibrationCandidateSchema = z.object({
  id: z.string().min(1),
  capturedAt: z.string().datetime(),
  originVisited: z.string().url(),
  layoutFingerprint: z.string().min(1),
  candidateSelectors: z.array(
    z.object({
      semanticGuess: z.string().min(1),
      selector: z.string().min(1),
      tagName: z.string().min(1),
      inputType: z.string().optional(),
      accessibleLabel: z.string().optional(),
      matchCount: z.number().int().nonnegative(),
      optionVocabulary: z.array(z.string()).optional()
    })
  ),
  zeroMatchWarnings: z.array(z.string()),
  multiMatchWarnings: z.array(z.string()),
  approved: z.boolean().default(false)
});
export type CalibrationCandidate = z.infer<typeof CalibrationCandidateSchema>;
