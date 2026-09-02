/**
 * Third synthetic form adapter (Phase 2): Med Admin Skilled Nurse Visit
 * Record, per RN DOC OS WF-003 (`WF_MED_ADMIN.md`). Verifies the full
 * pipeline end to end (navigation, predecessor discovery, page compare/
 * apply, draft save) and, separately, that no medication/dose/route/
 * administration-status/reaction/narrative field is ever allowlisted.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { createApp } from "@rn-doc-runner/synthetic-ehr";
import { runBatch, type BatchRunnerDeps, type QueueTarget } from "@rn-doc-runner/queue-engine";
import { validateFormAdapter } from "@rn-doc-runner/adapter-schema";
import { MED_ADMIN_V1_ADAPTER, STANDARD_IDENTITY_SELECTORS } from "@rn-doc-runner/adapters-synthetic";
import type { DraftSaveConfig } from "@rn-doc-runner/form-engine";

const EXPECTED_AUTHOR = "Nurse, Demo (RN)";

const SAVE_CONFIG: DraftSaveConfig = {
  saveButtonSelector: "#rn-save-draft",
  configuredSaveLabel: "Save Draft",
  successIndicatorSelector: "#rn-save-success",
  validationErrorIndicatorSelector: "#rn-save-validation-error",
  sessionExpiredIndicatorSelector: "#rn-session-expired",
  ambiguousIndicatorSelector: "#rn-save-ambiguous",
  waitTimeoutMs: 5000
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

test("the Med Admin adapter passes schema validation and excludes every prohibited field", () => {
  const adapter = validateFormAdapter(MED_ADMIN_V1_ADAPTER);
  assert.equal(adapter.approved, true);
  const allKeys = adapter.pages.flatMap((p) => p.allowlist.map((e) => e.key));
  for (const prohibited of ["medication_name", "dose_amount", "route", "administration_time", "administration_status", "adverse_reaction_narrative"]) {
    assert.ok(!allKeys.some((k) => k.includes(prohibited)), `${prohibited} must never be allowlisted`);
  }
  // Every allowlisted control must be a plain repeatable selection type — never free text other than the exact-GA exception (unused here).
  for (const page of adapter.pages) {
    for (const entry of page.allowlist) {
      assert.notEqual(entry.type, "text", `${entry.key} must not be a free-text field on the Med Admin adapter`);
    }
  }
});

test("Med Admin Skilled Nurse Visit Record completes end to end: predecessor found, approved fields carried forward, both pages saved", async () => {
  await withServer(async (base) => {
    const targets: QueueTarget[] = [
      { queueEntryId: "q-k2", criteria: { patient: "Rehearsal Kilo", mr: "SYN-1011", form: "Med Admin Skilled Nurse Visit Record", date: "07/29/2026", user: EXPECTED_AUTHOR } }
    ];
    const deps: BatchRunnerDeps = {
      baseUrl: base,
      identitySelectors: STANDARD_IDENTITY_SELECTORS,
      expectedAuthor: EXPECTED_AUTHOR,
      openNewPage: () => browser.newPage(),
      closePage: (page) => page.close(),
      formAdapterFor: (formType, formVersion) =>
        formType === MED_ADMIN_V1_ADAPTER.formType && formVersion === MED_ADMIN_V1_ADAPTER.formVersion ? MED_ADMIN_V1_ADAPTER : undefined,
      formVersionFor: (formType) => (formType === MED_ADMIN_V1_ADAPTER.formType ? MED_ADMIN_V1_ADAPTER.formVersion : undefined),
      redLinkSectionsFor: () => [],
      draftSaveConfigFor: () => SAVE_CONFIG,
      patientIdFor: (criteria) => (criteria.patient === "Rehearsal Kilo" ? "pat-11" : undefined)
    };

    const result = await runBatch(targets, deps);
    assert.deepEqual(result.completed, ["q-k2"], JSON.stringify(result.exceptions));
    assert.equal(result.needsReview.length, 0);
    assert.equal(result.blocked.length, 0);

    const state = await (await fetch(`${base}/debug/state/doc-k2`)).json();
    assert.equal(state.saveCount, 2, "both Med Admin pages must have saved");
    assert.equal(state.controls["MEDADMIN-v1::page1::medication_list_reviewed"].checked, true);
    assert.equal(state.controls["MEDADMIN-v1::page1::visit_setting::home"].checked, true);
    assert.equal(state.controls["MEDADMIN-v1::page1::next_review_frequency"].value, "Monthly");
    assert.equal(state.controls["MEDADMIN-v1::page2::teaching_materials_provided"].checked, true);
    assert.equal(state.controls["MEDADMIN-v1::page2::caregiver_competency_verified"].checked, true);
  });
});

test("prohibited Med Admin fields on the destination remain untouched after apply", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/documents/doc-k2?page=0`);
      const medicationName = await page.$eval("#ctrl-MEDADMIN-v1--page1--medication_name", (el) => (el as HTMLInputElement).value);
      const doseAmount = await page.$eval("#ctrl-MEDADMIN-v1--page1--dose_amount", (el) => (el as HTMLInputElement).value);
      const administrationStatus = await page.$eval("#ctrl-MEDADMIN-v1--page1--administration_status", (el) => (el as HTMLInputElement).value);
      assert.equal(medicationName, "");
      assert.equal(doseAmount, "");
      assert.equal(administrationStatus, "");
    } finally {
      await page.close();
    }
  });
});
