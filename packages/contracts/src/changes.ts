import { z } from "zod";
import { ControlTypeSchema } from "./form.js";

const baseProposal = z.object({
  key: z.string().min(1),
  type: ControlTypeSchema
});

export const ProposedChangeSchema = z.discriminatedUnion("type", [
  baseProposal.extend({ type: z.literal("checkbox"), checked: z.literal(true) }),
  baseProposal.extend({ type: z.literal("radio"), checked: z.literal(true) }),
  baseProposal.extend({ type: z.literal("select"), value: z.string().min(1) }),
  baseProposal.extend({ type: z.literal("text"), value: z.literal("GA") })
]);
export type ProposedChange = z.infer<typeof ProposedChangeSchema>;

/** An immutable proposal plan produced by comparison: what may be applied, and what could not be resolved. */
export const ProposalPlanSchema = z.object({
  proposals: z.array(ProposedChangeSchema),
  unresolved: z.array(
    z.object({
      key: z.string().min(1),
      reason: z.string().min(1)
    })
  )
});
export type ProposalPlan = z.infer<typeof ProposalPlanSchema>;

/** A change confirmed to have actually taken effect on re-read of the destination. */
export const AppliedChangeSchema = z.object({
  key: z.string().min(1),
  type: ControlTypeSchema,
  appliedAt: z.string().datetime(),
  verified: z.boolean()
});
export type AppliedChange = z.infer<typeof AppliedChangeSchema>;

export const SaveOutcomeSchema = z.enum([
  "SAVED",
  "VALIDATION_ERROR",
  "SESSION_EXPIRED",
  "AMBIGUOUS"
]);
export type SaveOutcome = z.infer<typeof SaveOutcomeSchema>;

/** Result of one Draft Save Adapter attempt. Idempotency key prevents duplicate saves/clicks. */
export const SaveResultSchema = z.object({
  outcome: SaveOutcomeSchema,
  idempotencyKey: z.string().min(1),
  attemptedAt: z.string().datetime(),
  queueEntryId: z.string().min(1),
  pageIndex: z.number().int().nonnegative()
});
export type SaveResult = z.infer<typeof SaveResultSchema>;
