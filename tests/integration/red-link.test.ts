import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { createApp } from "@rn-doc-runner/synthetic-ehr";
import { completeAllRedLinkSections, saveDraftPage, type DraftSaveConfig } from "@rn-doc-runner/form-engine";
import { RECERT_V1_RED_LINK_CONFIGS } from "@rn-doc-runner/adapters-synthetic";

const EXPECTED_AUTHOR = "Nurse, Demo (RN)";
const VERIFIED_VISIT_DATE = "07/14/2026"; // doc-b2's own Visit Date, per WF_PLAN_OF_CARE_DATE_UPDATES.md

let browser: Browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fetch(`http://127.0.0.1:${port}/debug/reset`, { method: "POST" });
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("completing both configured red-link sections (including the collapsed diagnoses group) unlocks the Plan of Care save", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-b2?page=1`);

      const result = await completeAllRedLinkSections(page, RECERT_V1_RED_LINK_CONFIGS, VERIFIED_VISIT_DATE);
      assert.equal(result.ok, true, JSON.stringify(result.sections));
      for (const section of result.sections) assert.equal(section.ok, true, `${section.sectionId}: ${section.failures.join(",")}`);

      const config: DraftSaveConfig = {
        saveButtonSelector: "#rn-save-draft",
        configuredSaveLabel: "Save Draft",
        successIndicatorSelector: "#rn-save-success",
        validationErrorIndicatorSelector: "#rn-save-validation-error",
        sessionExpiredIndicatorSelector: "#rn-session-expired",
        ambiguousIndicatorSelector: "#rn-save-ambiguous",
        requiredCompleteFieldSelectors: ["#redlink-diagnoses-status-field", "#redlink-orders-status-field"],
        waitTimeoutMs: 3000
      };
      const saveResult = await saveDraftPage({
        destinationPage: page,
        identitySelectors: { patient: "#rn-identity-patient", mr: "#rn-identity-mr", form: "#rn-identity-form", date: "#rn-identity-date", author: "#rn-identity-author", page: "#rn-identity-page" },
        expectedIdentity: { patient: "Rehearsal Bravo", mr: "SYN-1002", form: "OASIS/Nurse Recert", date: "07/14/2026", user: EXPECTED_AUTHOR },
        plan: { proposals: [], unresolved: [] },
        appliedVerification: { ok: true, failures: [] },
        config,
        queueEntryId: "queue-b2",
        pageIndex: 1,
        formVersion: "RECERT-v1",
        priorSuccessfulKeys: new Set()
      });
      assert.equal(saveResult.outcome, "SAVED");
    } finally {
      await page.close();
    }
  });
});

test("selecting rows without expanding the collapsed diagnoses group is caught by the EHR's own validation (defense in depth)", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-b2?page=1`);
      await page.click("#redlink-diagnoses-open");
      await page.check("#redlink-diagnoses-select-all"); // never expanded the collapsed group first
      await page.click("#redlink-diagnoses-batch-update-dates");
      await page.fill("#redlink-diagnoses-start-effective-date", VERIFIED_VISIT_DATE);
      await page.click("#redlink-diagnoses-update");
      await page.click("#redlink-diagnoses-insert");

      const errorText = await page.textContent("#redlink-diagnoses-error");
      assert.match(errorText ?? "", /collapsed group/i);
      const status = await page.$eval("#redlink-diagnoses-status-field", (el) => (el as HTMLInputElement).value);
      assert.equal(status, "incomplete");
    } finally {
      await page.close();
    }
  });
});

test("a partially selected row set is caught by the EHR's own validation (defense in depth)", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-b2?page=1`);
      await page.click("#redlink-orders-open"); // no collapsed group on this section
      await page.check("#redlink-orders-row-ord-1");
      // deliberately leave ord-2 unchecked
      await page.click("#redlink-orders-batch-update-dates");
      await page.fill("#redlink-orders-start-effective-date", VERIFIED_VISIT_DATE);
      await page.click("#redlink-orders-update");
      await page.click("#redlink-orders-insert");

      const errorText = await page.textContent("#redlink-orders-error");
      assert.match(errorText ?? "", /not every applicable row/i);
      const status = await page.$eval("#redlink-orders-status-field", (el) => (el as HTMLInputElement).value);
      assert.equal(status, "incomplete");
    } finally {
      await page.close();
    }
  });
});

test("changing the Discontinued Date is caught by the EHR's own validation and never lets insertion proceed (defense in depth)", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-b2?page=1`);
      await page.click("#redlink-orders-open");
      await page.check("#redlink-orders-select-all");
      await page.click("#redlink-orders-batch-update-dates");
      await page.fill("#redlink-orders-start-effective-date", VERIFIED_VISIT_DATE);
      await page.fill("#redlink-orders-discontinued-date", "01/01/2027"); // must never be touched
      await page.click("#redlink-orders-update");
      await page.click("#redlink-orders-insert");

      const errorText = await page.textContent("#redlink-orders-error");
      assert.match(errorText ?? "", /discontinued date must remain unchanged/i);
      const status = await page.$eval("#redlink-orders-status-field", (el) => (el as HTMLInputElement).value);
      assert.equal(status, "incomplete");
    } finally {
      await page.close();
    }
  });
});

/**
 * The three tests above check the synthetic EHR's own validation (defense
 * in depth). These two check ours: `completeRedLinkSection` clicks five
 * caller-configured controls per section, and a configuration that points
 * any of them at a finalization control must be refused by this codebase
 * — with no click issued — regardless of what the EHR would have done.
 */
test("a red-link config whose Insert selector points at the page's Sign button is refused, and Sign is never clicked", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-b2?page=1`);
      const orders = RECERT_V1_RED_LINK_CONFIGS.find((c) => c.sectionId === "orders")!;

      const result = await completeAllRedLinkSections(page, [{ ...orders, insertButtonSelector: "#rn-sign" }], VERIFIED_VISIT_DATE);

      assert.equal(result.ok, false);
      assert.ok(
        result.sections[0]!.failures.includes("label_matches_finalization_pattern:insert_button"),
        result.sections[0]!.failures.join(",")
      );
      const state = await (await fetch(`${base}/debug/state/doc-b2`)).json();
      assert.equal(state.saveCount, 0, "nothing on this page may be submitted by a refused red-link run");
    } finally {
      await page.close();
    }
  });
});

test("a red-link Insert control whose visible text is bland ('Continue') but whose aria-label is a finalization action is refused too", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-b2?page=1`);
      const orders = RECERT_V1_RED_LINK_CONFIGS.find((c) => c.sectionId === "orders")!;

      // The expected label deliberately MATCHES this control's visible text, so
      // the only thing that can refuse it is the accessible-name check.
      const result = await completeAllRedLinkSections(
        page,
        [{ ...orders, insertButtonSelector: "#rn-mislabeled-finalize", insertButtonLabel: "Continue" }],
        VERIFIED_VISIT_DATE
      );

      assert.equal(result.ok, false);
      assert.ok(
        result.sections[0]!.failures.includes("aria_label_matches_finalization_pattern:insert_button"),
        result.sections[0]!.failures.join(",")
      );
      const status = await page.$eval("#redlink-orders-status-field", (el) => (el as HTMLInputElement).value);
      assert.equal(status, "incomplete");
    } finally {
      await page.close();
    }
  });
});
