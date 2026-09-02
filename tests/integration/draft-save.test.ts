import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { createApp } from "@rn-doc-runner/synthetic-ehr";
import { saveDraftPage, type DraftSaveConfig } from "@rn-doc-runner/form-engine";
import { STANDARD_IDENTITY_SELECTORS } from "@rn-doc-runner/adapters-synthetic";

const EXPECTED_AUTHOR = "Nurse, Demo (RN)";
const EMPTY_PLAN = { proposals: [], unresolved: [] };
const OK_VERIFICATION = { ok: true, failures: [] };

const SNV_PAGE1_CONFIG: DraftSaveConfig = {
  saveButtonSelector: "#rn-save-draft",
  configuredSaveLabel: "Save Draft",
  successIndicatorSelector: "#rn-save-success",
  validationErrorIndicatorSelector: "#rn-save-validation-error",
  sessionExpiredIndicatorSelector: "#rn-session-expired",
  ambiguousIndicatorSelector: "#rn-save-ambiguous",
  waitTimeoutMs: 3000
};

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

test("a clean save reports SAVED and the EHR records exactly one save", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-a2?page=0`);
      const result = await saveDraftPage({
        destinationPage: page,
        identitySelectors: STANDARD_IDENTITY_SELECTORS,
        expectedIdentity: { patient: "Rehearsal Alpha", mr: "SYN-1001", form: "Skilled Nurse Visit Note", date: "07/28/2026", user: EXPECTED_AUTHOR },
        plan: EMPTY_PLAN,
        appliedVerification: OK_VERIFICATION,
        config: SNV_PAGE1_CONFIG,
        queueEntryId: "queue-a2",
        pageIndex: 0,
        formVersion: "SNV-v1",
        priorSuccessfulKeys: new Set()
      });
      assert.equal(result.outcome, "SAVED");
      const state = await (await fetch(`${base}/debug/state/doc-a2`)).json();
      assert.equal(state.saveCount, 1);
    } finally {
      await page.close();
    }
  });
});

test("an idempotency key already in priorSuccessfulKeys is blocked before any click occurs", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-h1?page=0`);
      const first = await saveDraftPage({
        destinationPage: page,
        identitySelectors: STANDARD_IDENTITY_SELECTORS,
        expectedIdentity: { patient: "Rehearsal Hotel", mr: "SYN-1008", form: "Skilled Nurse Visit Note", date: "06/08/2026", user: EXPECTED_AUTHOR },
        plan: EMPTY_PLAN,
        appliedVerification: OK_VERIFICATION,
        config: SNV_PAGE1_CONFIG,
        queueEntryId: "queue-h1",
        pageIndex: 0,
        formVersion: "SNV-v1",
        priorSuccessfulKeys: new Set()
      });
      assert.equal(first.outcome, "SAVED");

      const second = await saveDraftPage({
        destinationPage: page,
        identitySelectors: STANDARD_IDENTITY_SELECTORS,
        expectedIdentity: { patient: "Rehearsal Hotel", mr: "SYN-1008", form: "Skilled Nurse Visit Note", date: "06/08/2026", user: EXPECTED_AUTHOR },
        plan: EMPTY_PLAN,
        appliedVerification: OK_VERIFICATION,
        config: SNV_PAGE1_CONFIG,
        queueEntryId: "queue-h1",
        pageIndex: 0,
        formVersion: "SNV-v1",
        priorSuccessfulKeys: new Set([first.idempotencyKey])
      });
      assert.equal(second.outcome, "BLOCKED");
      assert.deepEqual(second.failures, ["duplicate_save_attempt_blocked"]);
      assert.equal(second.idempotencyKey, first.idempotencyKey);

      const state = await (await fetch(`${base}/debug/state/doc-h1`)).json();
      assert.equal(state.saveCount, 1, "the blocked attempt must never click through to the EHR");
    } finally {
      await page.close();
    }
  });
});

test("without prior-key tracking, a genuine double-click surfaces the EHR's own AMBIGUOUS outcome", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-i1?page=0`);
      const params = {
        destinationPage: page,
        identitySelectors: STANDARD_IDENTITY_SELECTORS,
        expectedIdentity: { patient: "Rehearsal India", mr: "SYN-1009", form: "Skilled Nurse Visit Note", date: "06/09/2026", user: EXPECTED_AUTHOR },
        plan: EMPTY_PLAN,
        appliedVerification: OK_VERIFICATION,
        config: SNV_PAGE1_CONFIG,
        queueEntryId: "queue-i1",
        pageIndex: 0,
        formVersion: "SNV-v1",
        priorSuccessfulKeys: new Set<string>()
      };
      const first = await saveDraftPage(params);
      assert.equal(first.outcome, "SAVED");
      // The first save auto-advanced to page 1; navigate back to page 0 to genuinely
      // re-click Save Draft on the SAME already-saved page (a real double-click), rather
      // than freshly saving page 1 for the first time.
      await page.goto(`${base}/documents/doc-i1?page=0`);
      const second = await saveDraftPage({ ...params, priorSuccessfulKeys: new Set() });
      assert.equal(second.outcome, "AMBIGUOUS");
    } finally {
      await page.close();
    }
  });
});

test("a document configured to always fail validation reports VALIDATION_ERROR", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-h2?page=0`);
      const result = await saveDraftPage({
        destinationPage: page,
        identitySelectors: STANDARD_IDENTITY_SELECTORS,
        expectedIdentity: { patient: "Rehearsal Hotel", mr: "SYN-1008", form: "Skilled Nurse Visit Note", date: "07/24/2026", user: EXPECTED_AUTHOR },
        plan: EMPTY_PLAN,
        appliedVerification: OK_VERIFICATION,
        config: SNV_PAGE1_CONFIG,
        queueEntryId: "queue-h2",
        pageIndex: 0,
        formVersion: "SNV-v1",
        priorSuccessfulKeys: new Set()
      });
      assert.equal(result.outcome, "VALIDATION_ERROR");
    } finally {
      await page.close();
    }
  });
});

test("a document configured to expire mid-save reports SESSION_EXPIRED", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-i2?page=0`);
      const result = await saveDraftPage({
        destinationPage: page,
        identitySelectors: STANDARD_IDENTITY_SELECTORS,
        expectedIdentity: { patient: "Rehearsal India", mr: "SYN-1009", form: "Skilled Nurse Visit Note", date: "07/23/2026", user: EXPECTED_AUTHOR },
        plan: EMPTY_PLAN,
        appliedVerification: OK_VERIFICATION,
        config: SNV_PAGE1_CONFIG,
        queueEntryId: "queue-i2",
        pageIndex: 0,
        formVersion: "SNV-v1",
        priorSuccessfulKeys: new Set()
      });
      assert.equal(result.outcome, "SESSION_EXPIRED");
    } finally {
      await page.close();
    }
  });
});

test("incomplete Plan of Care red-link sections block the save before any click reaches the EHR", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-b2?page=1`);
      const result = await saveDraftPage({
        destinationPage: page,
        identitySelectors: STANDARD_IDENTITY_SELECTORS,
        expectedIdentity: { patient: "Rehearsal Bravo", mr: "SYN-1002", form: "OASIS/Nurse Recert", date: "07/14/2026", user: EXPECTED_AUTHOR },
        plan: EMPTY_PLAN,
        appliedVerification: OK_VERIFICATION,
        config: { ...SNV_PAGE1_CONFIG, requiredCompleteFieldSelectors: ["#redlink-diagnoses-status-field", "#redlink-orders-status-field"] },
        queueEntryId: "queue-b2",
        pageIndex: 1,
        formVersion: "RECERT-v1",
        priorSuccessfulKeys: new Set()
      });
      assert.equal(result.outcome, "BLOCKED");
      assert.ok(result.failures[0]?.startsWith("red_link_section_incomplete"));
      const state = await (await fetch(`${base}/debug/state/doc-b2`)).json();
      assert.equal(state.saveCount, 0);
    } finally {
      await page.close();
    }
  });
});

test("identity mismatch immediately before save blocks the click entirely", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-a2?page=0`);
      const result = await saveDraftPage({
        destinationPage: page,
        identitySelectors: STANDARD_IDENTITY_SELECTORS,
        expectedIdentity: { patient: "Someone Else", mr: "SYN-1001", form: "Skilled Nurse Visit Note", date: "07/28/2026", user: EXPECTED_AUTHOR },
        plan: EMPTY_PLAN,
        appliedVerification: OK_VERIFICATION,
        config: SNV_PAGE1_CONFIG,
        queueEntryId: "queue-a2-bad",
        pageIndex: 0,
        formVersion: "SNV-v1",
        priorSuccessfulKeys: new Set()
      });
      assert.equal(result.outcome, "BLOCKED");
      assert.ok(result.failures.includes("patient_mismatch"));
      const state = await (await fetch(`${base}/debug/state/doc-a2`)).json();
      assert.equal(state.saveCount, 0);
    } finally {
      await page.close();
    }
  });
});

test("a save button misconfigured to point at a finalization control (Sign) is rejected by label, never clicked as if it were Save", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-a2?page=0`);
      const result = await saveDraftPage({
        destinationPage: page,
        identitySelectors: STANDARD_IDENTITY_SELECTORS,
        expectedIdentity: { patient: "Rehearsal Alpha", mr: "SYN-1001", form: "Skilled Nurse Visit Note", date: "07/28/2026", user: EXPECTED_AUTHOR },
        plan: EMPTY_PLAN,
        appliedVerification: OK_VERIFICATION,
        config: { ...SNV_PAGE1_CONFIG, saveButtonSelector: "#rn-sign" },
        queueEntryId: "queue-a2-misconfigured",
        pageIndex: 0,
        formVersion: "SNV-v1",
        priorSuccessfulKeys: new Set()
      });
      assert.equal(result.outcome, "BLOCKED");
      assert.ok(result.failures.includes("label_matches_finalization_pattern"));
    } finally {
      await page.close();
    }
  });
});

test("a save button whose visible text looks bland ('Continue') but whose aria-label reveals a finalization action is still rejected, never clicked", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-a2?page=0`);
      const result = await saveDraftPage({
        destinationPage: page,
        identitySelectors: STANDARD_IDENTITY_SELECTORS,
        expectedIdentity: { patient: "Rehearsal Alpha", mr: "SYN-1001", form: "Skilled Nurse Visit Note", date: "07/28/2026", user: EXPECTED_AUTHOR },
        plan: EMPTY_PLAN,
        appliedVerification: OK_VERIFICATION,
        // The configured label ("Save Draft") intentionally does NOT match this button's visible
        // text ("Continue") either, but the point of this test is specifically that even a
        // TEXT match would not be enough — the accessible name must be checked independently.
        config: { ...SNV_PAGE1_CONFIG, saveButtonSelector: "#rn-mislabeled-finalize", configuredSaveLabel: "Continue" },
        queueEntryId: "queue-a2-mislabeled",
        pageIndex: 0,
        formVersion: "SNV-v1",
        priorSuccessfulKeys: new Set()
      });
      assert.equal(result.outcome, "BLOCKED");
      assert.ok(result.failures.includes("aria_label_matches_finalization_pattern"), result.failures.join(","));
      const state = await (await fetch(`${base}/debug/state/doc-a2`)).json();
      assert.equal(state.saveCount, 0, "the mislabeled-finalize control must never be clicked");
    } finally {
      await page.close();
    }
  });
});

test("a save whose configured success indicator never appears is AMBIGUOUS even though the page navigated", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      // Page 0 of a two-page document: saving it auto-advances, so the URL
      // genuinely changes. With no configured indicator observable on the
      // page it lands on, that navigation proves nothing — it is exactly
      // what an error page or a session-timeout redirect looks like — and
      // the outcome must fail closed to human review rather than be
      // reported as a confirmed save.
      await page.goto(`${base}/documents/doc-a2?page=0`);
      const result = await saveDraftPage({
        destinationPage: page,
        identitySelectors: STANDARD_IDENTITY_SELECTORS,
        expectedIdentity: { patient: "Rehearsal Alpha", mr: "SYN-1001", form: "Skilled Nurse Visit Note", date: "07/28/2026", user: EXPECTED_AUTHOR },
        plan: EMPTY_PLAN,
        appliedVerification: OK_VERIFICATION,
        config: { ...SNV_PAGE1_CONFIG, successIndicatorSelector: "#rn-indicator-that-never-renders", waitTimeoutMs: 750 },
        queueEntryId: "queue-a2-unconfirmable",
        pageIndex: 0,
        formVersion: "SNV-v1",
        priorSuccessfulKeys: new Set()
      });
      assert.equal(result.outcome, "AMBIGUOUS");
      assert.deepEqual(result.failures, ["save_confirmation_indicator_absent_after_navigation"]);
    } finally {
      await page.close();
    }
  });
});
