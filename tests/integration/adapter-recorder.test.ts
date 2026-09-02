import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { createApp } from "@rn-doc-runner/synthetic-ehr";
import { extractCalibrationStructure, toCalibrationCandidate, isCalibrationCandidateReviewReady } from "@rn-doc-runner/adapter-schema";
import { SNV_V1_ADAPTER, SYNTHETIC_SITE_ADAPTER, RECERT_V1_ADAPTER } from "@rn-doc-runner/adapters-synthetic";
import { validateSiteAdapter, validateFormAdapter } from "@rn-doc-runner/adapter-schema";

let browser: Browser;
test.before(async () => {
  browser = await chromium.launch();
});
test.after(async () => {
  await browser.close();
});

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Calibration Mode recorder captures structure with zero patient data and no zero/multi-match selectors on a clean page", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-a2?page=0`);
      const raw = await page.evaluate(extractCalibrationStructure);
      assert.ok(raw.candidateSelectors.length > 5, "expected several candidate selectors");
      assert.deepEqual(raw.zeroMatchWarnings, []);
      assert.deepEqual(raw.multiMatchWarnings, []);

      const candidate = toCalibrationCandidate(raw, `${base}/documents/doc-a2?page=0`, "synthetic-ehr-v1", "cal-test-1");
      assert.equal(isCalibrationCandidateReviewReady(candidate), true);

      const serialized = JSON.stringify(candidate);
      assert.doesNotMatch(serialized, /Rehearsal Alpha/);
      assert.doesNotMatch(serialized, /SYN-1001/);
      assert.doesNotMatch(serialized, /07\/28\/2026/);

      const careControl = raw.candidateSelectors.find((c) => c.selector === "#ctrl-SNV-v1--page1--care_plan_reviewed");
      assert.ok(careControl);
      assert.equal(careControl?.inputType, "checkbox");
      assert.equal(careControl?.accessibleLabel, "Care plan reviewed with patient");

      const frequencySelect = raw.candidateSelectors.find((c) => c.selector === "#ctrl-SNV-v1--page1--visit_frequency");
      assert.deepEqual(frequencySelect?.optionVocabulary, ["Weekly", "Biweekly", "Monthly"]);
    } finally {
      await page.close();
    }
  });
});

test("the layout-drift document surfaces drifted identity ids as separate candidates with no duplicate/zero-match warnings for them", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-g2?page=0`);
      const raw = await page.evaluate(extractCalibrationStructure);
      const drifted = raw.candidateSelectors.filter((c) => c.selector.includes("-drift-v2"));
      assert.ok(drifted.length === 0, "identity spans are never captured by the recorder (no data-rn-key/input/select/textarea/a[id])");
      const anyIdentityMention = raw.candidateSelectors.some((c) => c.selector.includes("rn-identity"));
      assert.equal(anyIdentityMention, false, "identity elements must never appear as recorder candidates");
    } finally {
      await page.close();
    }
  });
});

test("the approved synthetic site adapter and form adapters pass full schema validation", () => {
  const siteResult = validateSiteAdapter(SYNTHETIC_SITE_ADAPTER);
  assert.equal(siteResult.enabled, true);
  assert.equal(siteResult.status, "APPROVED");
  assert.equal(siteResult.expectedOrigin, "http://localhost:4173");

  const snv = validateFormAdapter(SNV_V1_ADAPTER);
  const recert = validateFormAdapter(RECERT_V1_ADAPTER);
  const allKeys = [...snv.pages.flatMap((p) => p.allowlist.map((e) => e.key)), ...recert.pages.flatMap((p) => p.allowlist.map((e) => e.key))];
  for (const prohibited of ["pulse_rate", "pain_score", "wound_length_cm", "visit_narrative", "wound_measurement_cm", "assessment_narrative", "recert_narrative"]) {
    assert.ok(!allKeys.some((k) => k.includes(prohibited)), `${prohibited} must never be allowlisted`);
  }
});

test("the real Devero adapter remains disabled and unconfigured", async () => {
  const mod = await import("@rn-doc-runner/adapters-devero-disabled");
  assert.equal(mod.DEVERO_SITE_ADAPTER.enabled, false);
  assert.equal(mod.DEVERO_SITE_ADAPTER.status, "UNCONFIGURED");
  assert.deepEqual(mod.DEVERO_SITE_ADAPTER.allowlist, []);
});
