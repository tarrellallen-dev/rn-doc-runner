import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { createApp } from "@rn-doc-runner/synthetic-ehr";
import {
  compareSourceToDestination,
  highlightPlan,
  applyPlan,
  verifyAppliedTransitions,
  verifyOnlyAllowlistedControlsCarryHighlight,
  detectLayoutFingerprint,
  FormEngineError
} from "@rn-doc-runner/form-engine";
import {
  SNV_V1_ADAPTER,
  STANDARD_IDENTITY_SELECTORS,
  DRIFTED_IDENTITY_SELECTORS,
  SYNTHETIC_EHR_LAYOUT_FINGERPRINT,
  SYNTHETIC_EHR_DRIFTED_LAYOUT_FINGERPRINT
} from "@rn-doc-runner/adapters-synthetic";
import * as rules from "@rn-doc-runner/rules";

const EXPECTED_AUTHOR = "Nurse, Demo (RN)";
const PAGE1_ALLOWLIST = SNV_V1_ADAPTER.pages[0]!.allowlist;

let browser: Browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

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

test("end-to-end: verified predecessor proposes and applies only allowlisted, seeded controls; prohibited fields stay untouched", async () => {
  await withServer(async (base) => {
    const sourcePage = await browser.newPage();
    const destinationPage = await browser.newPage();
    try {
      await sourcePage.goto(`${base}/documents/doc-a1?page=0`);
      await destinationPage.goto(`${base}/documents/doc-a2?page=0`);

      const comparison = await compareSourceToDestination({
        sourcePage,
        destinationPage,
        identitySelectors: STANDARD_IDENTITY_SELECTORS,
        allowlist: PAGE1_ALLOWLIST,
        expectedAuthor: EXPECTED_AUTHOR
      });

      assert.equal(comparison.identityResult.ok, true, comparison.identityResult.failures.join(","));
      assert.ok(comparison.plan);
      assert.equal(comparison.plan!.unresolved.length, 0);
      const keys = comparison.plan!.proposals.map((p) => p.key);
      assert.ok(keys.includes("SNV-v1::page1::care_plan_reviewed"));
      assert.ok(keys.includes("SNV-v1::page1::ambulation_status::independent"));
      assert.ok(keys.includes("SNV-v1::page1::visit_frequency"));
      assert.ok(keys.includes("SNV-v1::page1::anesthesia_exception"));

      await highlightPlan(destinationPage, PAGE1_ALLOWLIST, comparison.plan!);
      const highlightedCount = await destinationPage.evaluate(() => document.querySelectorAll("[data-rn-doc-runner-proposed]").length);
      assert.equal(highlightedCount, comparison.plan!.proposals.length);

      const applyResult = await applyPlan(destinationPage, PAGE1_ALLOWLIST, comparison.plan!);
      assert.equal(applyResult.applied, comparison.plan!.proposals.length);

      const verification = await verifyAppliedTransitions(destinationPage, PAGE1_ALLOWLIST, comparison.plan!.proposals);
      assert.equal(verification.ok, true, verification.failures.join(","));

      const noStrayHighlights = await verifyOnlyAllowlistedControlsCarryHighlight(destinationPage);
      assert.equal(noStrayHighlights.ok, true);

      // Prohibited fields must remain exactly as rendered (never touched by apply, never in the allowlist).
      const pulseValue = await destinationPage.$eval("#ctrl-SNV-v1--page1--pulse_rate", (el) => (el as HTMLInputElement).value);
      const narrativeValue = await destinationPage.$eval("#ctrl-SNV-v1--page1--visit_narrative", (el) => (el as HTMLInputElement).value);
      assert.equal(pulseValue, "");
      assert.equal(narrativeValue, "");
      assert.ok(!PAGE1_ALLOWLIST.some((e) => e.key.includes("pulse_rate") || e.key.includes("visit_narrative")));
    } finally {
      await sourcePage.close();
      await destinationPage.close();
    }
  });
});

test("mismatched patient identity blocks comparison entirely — no plan is ever generated", async () => {
  await withServer(async (base) => {
    const sourcePage = await browser.newPage();
    const destinationPage = await browser.newPage();
    try {
      await sourcePage.goto(`${base}/documents/doc-a1?page=0`); // Rehearsal Alpha
      await destinationPage.goto(`${base}/documents/doc-d2?page=0`); // Rehearsal Delta

      const comparison = await compareSourceToDestination({
        sourcePage,
        destinationPage,
        identitySelectors: STANDARD_IDENTITY_SELECTORS,
        allowlist: PAGE1_ALLOWLIST,
        expectedAuthor: EXPECTED_AUTHOR
      });

      assert.equal(comparison.identityResult.ok, false);
      assert.ok(comparison.identityResult.failures.includes("patient_mismatch"));
      assert.equal(comparison.plan, undefined);
    } finally {
      await sourcePage.close();
      await destinationPage.close();
    }
  });
});

test("wrong-author predecessor blocks comparison", async () => {
  await withServer(async (base) => {
    const sourcePage = await browser.newPage();
    const destinationPage = await browser.newPage();
    try {
      await sourcePage.goto(`${base}/documents/doc-d1?page=0`); // authored by Rivera, Jordan (RN)
      await destinationPage.goto(`${base}/documents/doc-d2?page=0`);

      const comparison = await compareSourceToDestination({
        sourcePage,
        destinationPage,
        identitySelectors: STANDARD_IDENTITY_SELECTORS,
        allowlist: PAGE1_ALLOWLIST,
        expectedAuthor: EXPECTED_AUTHOR
      });

      assert.equal(comparison.identityResult.ok, false);
      assert.ok(comparison.identityResult.failures.includes("source_author_mismatch"));
    } finally {
      await sourcePage.close();
      await destinationPage.close();
    }
  });
});

test("applyPlan refuses to apply any plan with unresolved items (fail closed)", async () => {
  await withServer(async (base) => {
    const destinationPage = await browser.newPage();
    try {
      await destinationPage.goto(`${base}/documents/doc-a2?page=0`);
      const badPlan = { proposals: [], unresolved: [{ key: "x", reason: "y" }] };
      await assert.rejects(() => applyPlan(destinationPage, PAGE1_ALLOWLIST, badPlan), FormEngineError);
    } finally {
      await destinationPage.close();
    }
  });
});

test("layout fingerprint detection distinguishes standard vs. drifted destination pages", async () => {
  await withServer(async (base) => {
    const standardPage = await browser.newPage();
    const driftedPage = await browser.newPage();
    try {
      await standardPage.goto(`${base}/documents/doc-a2?page=0`);
      await driftedPage.goto(`${base}/documents/doc-g2?page=0`);
      const candidates = [
        { fingerprint: SYNTHETIC_EHR_LAYOUT_FINGERPRINT, selectors: STANDARD_IDENTITY_SELECTORS },
        { fingerprint: SYNTHETIC_EHR_DRIFTED_LAYOUT_FINGERPRINT, selectors: DRIFTED_IDENTITY_SELECTORS }
      ];
      const standardResult = await detectLayoutFingerprint(standardPage, candidates);
      const driftedResult = await detectLayoutFingerprint(driftedPage, candidates);
      assert.equal(standardResult.fingerprint, SYNTHETIC_EHR_LAYOUT_FINGERPRINT);
      assert.equal(driftedResult.fingerprint, SYNTHETIC_EHR_DRIFTED_LAYOUT_FINGERPRINT);
      assert.equal(rules.verifyLayoutVersion(driftedResult.fingerprint, SYNTHETIC_EHR_LAYOUT_FINGERPRINT).ok, false);
    } finally {
      await standardPage.close();
      await driftedPage.close();
    }
  });
});

test("comparing pages that are not actually aligned (destination on page 2) fails on page_mismatch, not a false proposal", async () => {
  await withServer(async (base) => {
    const sourcePage = await browser.newPage();
    const destinationPage = await browser.newPage();
    try {
      await sourcePage.goto(`${base}/documents/doc-a1?page=0`);
      await destinationPage.goto(`${base}/documents/doc-a2?page=1`);
      const comparison = await compareSourceToDestination({
        sourcePage,
        destinationPage,
        identitySelectors: STANDARD_IDENTITY_SELECTORS,
        allowlist: PAGE1_ALLOWLIST,
        expectedAuthor: EXPECTED_AUTHOR
      });
      assert.equal(comparison.identityResult.ok, false);
      assert.ok(comparison.identityResult.failures.includes("page_mismatch"));
    } finally {
      await sourcePage.close();
      await destinationPage.close();
    }
  });
});
