import test from "node:test";
import assert from "node:assert/strict";
import * as formEngine from "@rn-doc-runner/form-engine";
import * as queueEngine from "@rn-doc-runner/queue-engine";
import * as adaptersSynthetic from "@rn-doc-runner/adapters-synthetic";

/** Same vocabulary as @rn-doc-runner/rules' FINALIZATION_PATTERN, kept independent so this structural check doesn't depend on that package's exact regex staying in sync. */
const SUSPICIOUS_EXPORT_NAME_PATTERN = /\b(sign|submit|finaliz\w*|finalis\w*|lock|send.?to.?office|activate|attest\w*|certif\w*|upload\w*)\b/i;

test("no export anywhere in @rn-doc-runner/form-engine is capable of targeting a finalization control by name", () => {
  const offendingExports = Object.keys(formEngine).filter((name) => SUSPICIOUS_EXPORT_NAME_PATTERN.test(name));
  assert.deepEqual(offendingExports, [], `these exports look like they could target finalization controls: ${offendingExports.join(", ")}`);
});

test("every exported function whose name implies clicking anything at all is one of the known, label-guarded few", () => {
  // `clickVerifiedControl` is the single chokepoint every click in this
  // package goes through: it refuses any control whose text or accessible
  // name matches the finalization pattern before activating it. Adding a
  // name to this list means adding a new way to activate a control, which
  // is exactly the change that should have to be argued for in review.
  const clickLikeExports = Object.keys(formEngine).filter((name) => /click|save|apply/i.test(name));
  assert.deepEqual(clickLikeExports.sort(), ["applyPlan", "applyProposalsInPage", "clickVerifiedControl", "saveDraftPage"].sort());
});

// --- P2-4: the same structural guarantee, extended to every package capable of driving the EHR ---
test("P2-4: no export anywhere in @rn-doc-runner/queue-engine (the batch runner) is capable of targeting a finalization control by name", () => {
  const offendingExports = Object.keys(queueEngine).filter((name) => SUSPICIOUS_EXPORT_NAME_PATTERN.test(name));
  assert.deepEqual(offendingExports, [], `these exports look like they could target finalization controls: ${offendingExports.join(", ")}`);
});

test("P2-4: no exported adapter action in @rn-doc-runner/adapters-synthetic (the only 'adapter actions' this build defines) implies a finalization control", () => {
  const offendingExports = Object.keys(adaptersSynthetic).filter((name) => SUSPICIOUS_EXPORT_NAME_PATTERN.test(name));
  assert.deepEqual(offendingExports, [], `these exports look like they could target finalization controls: ${offendingExports.join(", ")}`);

  // The allowlist itself is the only "action surface" a form adapter exposes (checkbox/radio/select/text
  // transitions) — there is structurally no way to encode a button click or a save/sign/submit action inside
  // it, since FieldAllowlistEntrySchema's control-type union has no "button" member. Confirm that invariant
  // holds for every adapter this build ships, not just assert it in a comment.
  for (const adapter of adaptersSynthetic.SYNTHETIC_FORM_ADAPTERS) {
    for (const page of adapter.pages) {
      for (const entry of page.allowlist) {
        assert.notEqual(entry.type, "button", `${adapter.formType}/${adapter.formVersion} allowlist entry "${entry.key}" must never be a button`);
        assert.ok(["checkbox", "radio", "select", "text"].includes(entry.type), `unexpected control type on ${entry.key}: ${entry.type}`);
      }
    }
  }
});
