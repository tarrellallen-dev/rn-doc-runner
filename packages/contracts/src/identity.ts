import { z } from "zod";

/**
 * Identity of a document as read from the EHR: the fields that must match
 * exactly between a source (predecessor) document and a destination
 * (current) document before any mechanical work is permitted.
 */
export const DocumentIdentitySchema = z.object({
  patient: z.string().min(1),
  mr: z.string().min(1),
  form: z.string().min(1),
  date: z.string().min(1),
  author: z.string().min(1),
  page: z.string().min(1)
});
export type DocumentIdentity = z.infer<typeof DocumentIdentitySchema>;

/** Identity of the verified predecessor ("source") document. */
export const SourceDocumentIdentitySchema = DocumentIdentitySchema.extend({
  documentId: z.string().optional()
});
export type SourceDocumentIdentity = z.infer<typeof SourceDocumentIdentitySchema>;

/** Identity of the current pending ("destination") document being completed. */
export const DestinationDocumentIdentitySchema = DocumentIdentitySchema.extend({
  documentId: z.string().optional()
});
export type DestinationDocumentIdentity = z.infer<typeof DestinationDocumentIdentitySchema>;

export const IdentityVerificationResultSchema = z.object({
  ok: z.boolean(),
  failures: z.array(z.string())
});
export type IdentityVerificationResult = z.infer<typeof IdentityVerificationResultSchema>;
