import { z } from "zod";

/** Supported deterministic control types. Never extend beyond this set without a new safety review. */
export const ControlTypeSchema = z.enum(["checkbox", "radio", "select", "text"]);
export type ControlType = z.infer<typeof ControlTypeSchema>;

/** An exact, unique-selector form version, tied to a validated EHR layout. */
export const FormVersionSchema = z.object({
  formType: z.string().min(1),
  formVersion: z.string().min(1),
  layoutFingerprint: z.string().min(1)
});
export type FormVersion = z.infer<typeof FormVersionSchema>;

/** Identity of a single page within a multi-page form. */
export const PageIdentitySchema = z.object({
  formType: z.string().min(1),
  formVersion: z.string().min(1),
  pageLabel: z.string().min(1),
  pageIndex: z.number().int().nonnegative()
});
export type PageIdentity = z.infer<typeof PageIdentitySchema>;

const baseAllowlistEntry = z.object({
  key: z.string().min(1),
  selector: z.string().min(1),
  type: ControlTypeSchema,
  label: z.string().min(1)
});

export const CheckboxAllowlistEntrySchema = baseAllowlistEntry.extend({
  type: z.literal("checkbox")
});

export const RadioAllowlistEntrySchema = baseAllowlistEntry.extend({
  type: z.literal("radio"),
  group: z.string().min(1)
});

export const SelectAllowlistEntrySchema = baseAllowlistEntry.extend({
  type: z.literal("select"),
  defaultValue: z.string(),
  allowedValues: z.array(z.string().min(1)).min(1),
  expectedOptions: z.array(z.string()).optional()
});

/** The only supported free-text transition: exact "GA" and nothing else. */
export const TextAllowlistEntrySchema = baseAllowlistEntry.extend({
  type: z.literal("text"),
  exactValue: z.literal("GA")
});

/** Field allowlist entry: one explicitly RN-approved repeatable control for one exact form version. */
export const FieldAllowlistEntrySchema = z.discriminatedUnion("type", [
  CheckboxAllowlistEntrySchema,
  RadioAllowlistEntrySchema,
  SelectAllowlistEntrySchema,
  TextAllowlistEntrySchema
]);
export type FieldAllowlistEntry = z.infer<typeof FieldAllowlistEntrySchema>;

/** A prohibited-field guard list, used only to assert absence — never populated with clinical values. */
export const ProhibitedFieldKindSchema = z.enum([
  "vital",
  "pain",
  "wound",
  "numeric",
  "medication",
  "comment",
  "narrative",
  "signature",
  "finalization"
]);
export type ProhibitedFieldKind = z.infer<typeof ProhibitedFieldKindSchema>;

/** One page's worth of an approved form-version field adapter. */
export const FormAdapterPageSchema = z.object({
  page: PageIdentitySchema,
  allowlist: z.array(FieldAllowlistEntrySchema)
});
export type FormAdapterPage = z.infer<typeof FormAdapterPageSchema>;

/** A complete, versioned field adapter for one form type. Ships empty/disabled until RN-approved. */
export const FormAdapterSchema = z.object({
  formType: z.string().min(1),
  formVersion: z.string().min(1),
  layoutFingerprint: z.string().min(1),
  approved: z.boolean(),
  pages: z.array(FormAdapterPageSchema)
});
export type FormAdapter = z.infer<typeof FormAdapterSchema>;
