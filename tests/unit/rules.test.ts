import test from "node:test";
import assert from "node:assert/strict";
import * as rules from "@rn-doc-runner/rules";
import type { FieldAllowlistEntry } from "@rn-doc-runner/contracts";

const baseSource = {
  patient: "Training Patient",
  mr: "SYN-001",
  form: "Synthetic Nurse Recert",
  date: "07/20/2026",
  author: "Nurse, Demo (RN)",
  page: "Page 2"
};
const baseDestination = { ...baseSource, date: "07/27/2026" };
const EXPECTED_AUTHOR = "Nurse, Demo (RN)";

// --- T01 / T02: authorized source author ---
test("T01: source User exactly authorized is accepted after all other gates", () => {
  assert.deepEqual(rules.verifyIdentity(baseSource, baseDestination, EXPECTED_AUTHOR), {
    ok: true,
    failures: []
  });
});

test("T02: source User differs -> immediate stop with mismatch failure", () => {
  const result = rules.verifyIdentity({ ...baseSource, author: "Other, RN" }, baseDestination, EXPECTED_AUTHOR);
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("source_author_mismatch"));
});

// --- T19: patient/MR mismatch ---
test("T19: patient or MR mismatch is an immediate identity failure", () => {
  const patientMismatch = rules.verifyIdentity({ ...baseSource, patient: "Other" }, baseDestination, EXPECTED_AUTHOR);
  assert.ok(patientMismatch.failures.includes("patient_mismatch"));
  const mrMismatch = rules.verifyIdentity({ ...baseSource, mr: "SYN-999" }, baseDestination, EXPECTED_AUTHOR);
  assert.ok(mrMismatch.failures.includes("mr_mismatch"));
});

// --- T23: chronology ---
test("T23: source date same as or later than destination is a hard stop", () => {
  const same = rules.verifyIdentity(baseSource, { ...baseDestination, date: baseSource.date }, EXPECTED_AUTHOR);
  assert.ok(same.failures.includes("source_not_earlier"));
  const later = rules.verifyIdentity({ ...baseSource, date: "08/01/2026" }, baseDestination, EXPECTED_AUTHOR);
  assert.ok(later.failures.includes("source_not_earlier"));
});

test("invalid date formats never validate", () => {
  assert.equal(rules.parseUsDate("2026-07-20"), null);
  assert.equal(rules.parseUsDate("13/40/2026"), null);
  assert.equal(rules.parseUsDate("02/30/2026"), null);
  assert.equal(rules.parseUsDate(""), null);
  assert.equal(rules.parseUsDate(undefined), null);
  assert.equal(typeof rules.parseUsDate("07/20/2026"), "number");
});

// --- T05: page alignment ---
test("T05: source/destination pages differ -> no proposal until aligned", () => {
  const result = rules.verifyIdentity(baseSource, { ...baseDestination, page: "Page 3" }, EXPECTED_AUTHOR);
  assert.ok(result.failures.includes("page_mismatch"));
});

// --- T24: separate tabs ---
test("T24: source and destination in the same tab is refused", () => {
  assert.equal(rules.verifySeparateTabs("tab-1", "tab-1").ok, false);
  assert.equal(rules.verifySeparateTabs("tab-1", "tab-2").ok, true);
  assert.equal(rules.verifySeparateTabs(undefined, "tab-2").ok, false);
});

// --- T22: unique selector enforcement ---
test("T22: identity selector matching zero or multiple elements is a hard stop", () => {
  assert.equal(rules.requireUniqueMatch(0, "#patient").ok, false);
  assert.equal(rules.requireUniqueMatch(2, "#patient").ok, false);
  assert.equal(rules.requireUniqueMatch(1, "#patient").ok, true);
});

// --- Layout drift ---
test("layout fingerprint drift is detected", () => {
  assert.equal(rules.verifyLayoutVersion("fp-v1", "fp-v1").ok, true);
  assert.equal(rules.verifyLayoutVersion("fp-v2", "fp-v1").ok, false);
  assert.equal(rules.verifyLayoutVersion(null, "fp-v1").ok, false);
});

// --- T09: checkbox transitions ---
test("T09: approved checkbox compatible allows false->true only when source checked", () => {
  const allowlist: FieldAllowlistEntry[] = [
    { key: "p2::approved", type: "checkbox", selector: "#approved", label: "Approved control" }
  ];
  const plan = rules.buildPlan(
    [{ key: "p2::approved", type: "checkbox", checked: true }],
    [{ key: "p2::approved", type: "checkbox", checked: false }],
    allowlist
  );
  assert.deepEqual(plan, { proposals: [{ key: "p2::approved", type: "checkbox", checked: true }], unresolved: [] });
});

test("checkbox already true produces no proposal (never a false->true transition needed)", () => {
  const allowlist: FieldAllowlistEntry[] = [
    { key: "p2::approved", type: "checkbox", selector: "#approved", label: "Approved control" }
  ];
  const plan = rules.buildPlan(
    [{ key: "p2::approved", type: "checkbox", checked: true }],
    [{ key: "p2::approved", type: "checkbox", checked: true }],
    allowlist
  );
  assert.deepEqual(plan, { proposals: [], unresolved: [] });
});

// --- T26: non-allowlisted controls ignored ---
test("T26: non-allowlisted control selected in source is ignored, never proposed", () => {
  const allowlist: FieldAllowlistEntry[] = [
    { key: "p2::approved", type: "checkbox", selector: "#approved", label: "Approved" }
  ];
  const plan = rules.buildPlan(
    [
      { key: "p2::approved", type: "checkbox", checked: true },
      { key: "p2::blocked", type: "checkbox", checked: true }
    ],
    [
      { key: "p2::approved", type: "checkbox", checked: false },
      { key: "p2::blocked", type: "checkbox", checked: false }
    ],
    allowlist
  );
  assert.equal(plan.proposals.length, 1);
  assert.equal(plan.proposals[0]?.key, "p2::approved");
});

// --- T20 / radio contradiction ---
test("T20/radio: contradictory destination selection blocks the plan", () => {
  const allowlist: FieldAllowlistEntry[] = [
    { key: "p2::status::yes", type: "radio", group: "status", selector: "#status-yes", label: "Yes" },
    { key: "p2::status::no", type: "radio", group: "status", selector: "#status-no", label: "No" }
  ];
  const plan = rules.buildPlan(
    [{ key: "p2::status::yes", group: "status", type: "radio", checked: true }],
    [
      { key: "p2::status::yes", group: "status", type: "radio", checked: false },
      { key: "p2::status::no", group: "status", type: "radio", checked: true }
    ],
    allowlist
  );
  assert.equal(plan.proposals.length, 0);
  assert.equal(plan.unresolved[0]?.reason, "contradictory_destination_radio");
  assert.equal(rules.isFailClosed(plan), true);
});

// --- Dropdown allowlist ---
test("select values must be explicitly allowlisted", () => {
  const allowlist: FieldAllowlistEntry[] = [
    {
      key: "p2::frequency",
      type: "select",
      selector: "#frequency",
      label: "Frequency",
      defaultValue: "",
      allowedValues: ["Weekly"]
    }
  ];
  const plan = rules.buildPlan(
    [{ key: "p2::frequency", type: "select", value: "Daily" }],
    [{ key: "p2::frequency", type: "select", value: "" }],
    allowlist
  );
  assert.equal(plan.proposals.length, 0);
  assert.equal(plan.unresolved[0]?.reason, "source_value_not_allowlisted");
});

// --- T27: contradictory meaningful destination value ---
test("T27: destination contains a different meaningful value -> no overwrite, unresolved", () => {
  const allowlist: FieldAllowlistEntry[] = [
    {
      key: "p2::frequency",
      type: "select",
      selector: "#frequency",
      label: "Frequency",
      defaultValue: "",
      allowedValues: ["Weekly", "Monthly"]
    }
  ];
  const plan = rules.buildPlan(
    [{ key: "p2::frequency", type: "select", value: "Weekly" }],
    [{ key: "p2::frequency", type: "select", value: "Monthly" }],
    allowlist
  );
  assert.equal(plan.proposals.length, 0);
  assert.equal(plan.unresolved[0]?.reason, "contradictory_destination_select");
});

// --- T07 / T08: exact GA exception ---
test("T07: exact GA source text proposes only in the compatible field", () => {
  const allowlist: FieldAllowlistEntry[] = [
    { key: "p2::exception", type: "text", selector: "#ga", label: "Exception", exactValue: "GA" }
  ];
  const plan = rules.buildPlan(
    [{ key: "p2::exception", type: "text", value: "GA" }],
    [{ key: "p2::exception", type: "text", value: "" }],
    allowlist
  );
  assert.equal(plan.proposals[0]?.type, "text");
  assert.equal((plan.proposals[0] as { value: string }).value, "GA");
});

test("T08: GA variants (whitespace, punctuation, expansion) never propose", () => {
  const allowlist: FieldAllowlistEntry[] = [
    { key: "p2::exception", type: "text", selector: "#ga", label: "Exception", exactValue: "GA" }
  ];
  for (const variant of ["GA ", "GA.", "ga", "General Anesthesia", "GA-"]) {
    const plan = rules.buildPlan(
      [{ key: "p2::exception", type: "text", value: variant }],
      [{ key: "p2::exception", type: "text", value: "" }],
      allowlist
    );
    assert.equal(plan.proposals.length, 0, `variant "${variant}" must not propose`);
  }
});

// --- T16: structural mismatch ---
test("T16: field structure mismatch produces no proposal and unresolved result", () => {
  const allowlist: FieldAllowlistEntry[] = [
    { key: "p2::approved", type: "checkbox", selector: "#approved", label: "Approved" }
  ];
  const plan = rules.buildPlan(
    [{ key: "p2::approved", type: "checkbox", checked: true }],
    [{ key: "p2::approved", type: "select", value: "" }],
    allowlist
  );
  assert.equal(plan.proposals.length, 0);
  assert.equal(plan.unresolved[0]?.reason, "missing_or_incompatible_destination");
});

// --- T18 / finalization detection ---
test("T18: finalization labels are always detectable and never proposed as save targets", () => {
  for (const label of ["Sign", "Submit", "Send to Office", "Finalize", "Complete", "Lock"]) {
    assert.equal(rules.isFinalizationLabel(label), true, label);
  }
  assert.equal(rules.isFinalizationLabel("Save Draft"), false);
});

// --- P2-4: full RN DOC OS finalization vocabulary, including noun/gerund variants ---
test("P2-4: every finalization verb from the Phase 2 prohibition list is detectable, including noun/gerund variants", () => {
  const finalizationLabels = [
    "Sign",
    "Electronically Sign",
    "Attest",
    "Attestation",
    "Attest and Complete",
    "Submit",
    "Submit for Review",
    "Finalize",
    "Finalise Note",
    "Lock",
    "Lock Record",
    "Certify",
    "Certification",
    "Certify Record",
    "Send to Office",
    "Send  to   Office",
    "Upload",
    "Uploading",
    "Upload to EHR",
    "Complete",
    "Activate"
  ];
  for (const label of finalizationLabels) {
    assert.equal(rules.isFinalizationLabel(label), true, label);
  }
});

test("P2-4: ordinary Save Draft / navigation / nonclinical labels are never mistaken for finalization controls", () => {
  const safeLabels = [
    "Save Draft",
    "Save",
    "Save and Continue",
    "Cancel",
    "Next Page",
    "Previous",
    "Print Preview",
    "Refresh",
    "Home",
    "Signature Pad" // contains "Sign" as a substring only inside a longer word ("Signature"), never as a whole word
  ];
  for (const label of safeLabels) {
    assert.equal(rules.isFinalizationLabel(label), false, label);
  }
});

// --- Save-draft label validation ---
test("save draft label must match configured label and never the finalization pattern", () => {
  assert.equal(rules.validateSaveDraftLabel("Save Draft", "Save Draft").ok, true);
  assert.equal(rules.validateSaveDraftLabel("save draft", "Save Draft").ok, true);
  assert.equal(rules.validateSaveDraftLabel("Sign", "Save Draft").ok, false);
  assert.equal(rules.validateSaveDraftLabel("Submit Draft", "Save Draft").ok, false);
});

// --- Duplicate-save prevention ---
test("duplicate-save prevention via idempotency key", () => {
  const key = rules.computeIdempotencyKey("queue-1", 2, "SNV-v3");
  assert.equal(rules.wasAlreadySaved(key, [key]), true);
  assert.equal(rules.wasAlreadySaved(key, []), false);
  assert.equal(rules.computeIdempotencyKey("queue-1", 2, "SNV-v3"), key);
});

// --- Prohibited field guard ---
test("prohibited field labels are rejected from allowlist candidacy", () => {
  assert.equal(rules.assertFieldNotProhibited("Pain scale (0-10)").ok, false);
  assert.equal(rules.assertFieldNotProhibited("Wound measurement").ok, false);
  assert.equal(rules.assertFieldNotProhibited("Sign here").ok, false);
  assert.equal(rules.assertFieldNotProhibited("Approved repeatable control").ok, true);
});

// --- Fail-closed ---
test("isFailClosed reflects any unresolved item", () => {
  assert.equal(rules.isFailClosed({ proposals: [], unresolved: [] }), false);
  assert.equal(rules.isFailClosed({ proposals: [], unresolved: [{ key: "x", reason: "y" }] }), true);
});
