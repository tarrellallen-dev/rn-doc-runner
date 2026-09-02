/**
 * The canonical synthetic acceptance test (Task 16):
 *
 *   synthetic worklist image -> OCR -> queue -> pending form ->
 *   predecessor -> supported pages -> configured updates -> saved
 *   drafts -> completion summary
 *
 * Run across multiple synthetic patients, multiple form dates, a
 * failure case (ambiguous predecessor, no qualifying predecessor), and
 * an unsupported form entry — end to end, starting from an actual
 * on-device OCR pass over a generated image, not hand-written queue
 * data.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { createApp } from "@rn-doc-runner/synthetic-ehr";
import {
  SwiftVisionOcrProvider,
  extractWorklistRowsFromOcrLines,
  buildWorklistRows,
  runBatch,
  type BatchRunnerDeps
} from "@rn-doc-runner/queue-engine";
import {
  SNV_V1_ADAPTER,
  RECERT_V1_ADAPTER,
  RECERT_V1_RED_LINK_CONFIGS,
  STANDARD_IDENTITY_SELECTORS,
  SYNTHETIC_SITE_ADAPTER
} from "@rn-doc-runner/adapters-synthetic";
import type { DraftSaveConfig } from "@rn-doc-runner/form-engine";
import { resolveQueueTargets } from "@rn-doc-runner/desktop/main/resolve-queue-targets";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const OCR_BINARY_PATH = path.join(PROJECT_ROOT, "ocr-helper/.build/release/ocr-helper");

const SAVE_CONFIG: DraftSaveConfig = {
  saveButtonSelector: "#rn-save-draft",
  configuredSaveLabel: "Save Draft",
  successIndicatorSelector: "#rn-save-success",
  validationErrorIndicatorSelector: "#rn-save-validation-error",
  sessionExpiredIndicatorSelector: "#rn-session-expired",
  ambiguousIndicatorSelector: "#rn-save-ambiguous",
  waitTimeoutMs: 5000
};

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

test("synthetic worklist image -> OCR -> queue -> batch -> completion summary, across successes, review cases, and an unsupported form", async (t) => {
  if (!fs.existsSync(OCR_BINARY_PATH)) {
    t.skip(`ocr-helper not built at ${OCR_BINARY_PATH} — run "swift build -c release" in ocr-helper/`);
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-doc-runner-acceptance-"));
  const rowsPath = path.join(tmpDir, "rows.json");
  const imagePath = path.join(tmpDir, "worklist.png");

  // Five synthetic patients spanning: two eligible documents (different
  // form types, different dates), an ambiguous predecessor, a missing
  // qualifying predecessor, and an unsupported/unrecognized form.
  const syntheticRows = [
    { patient: "Rehearsal Alpha", date: "07/28/2026", daysOutstanding: 3, category: "Skilled Nurse Visit Note" },
    { patient: "Rehearsal Bravo", date: "07/14/2026", daysOutstanding: 17, category: "OASIS/Nurse Recert" },
    { patient: "Rehearsal Charlie", date: "07/20/2026", daysOutstanding: 11, category: "Skilled Nurse Visit Note" },
    { patient: "Rehearsal Delta", date: "07/22/2026", daysOutstanding: 9, category: "Skilled Nurse Visit Note" },
    { patient: "Rehearsal Foxtrot", date: "07/18/2026", daysOutstanding: 13, category: "Wound Care Note" }
  ];
  fs.writeFileSync(rowsPath, JSON.stringify(syntheticRows));
  await execFileAsync(OCR_BINARY_PATH, ["generate-worklist", imagePath, rowsPath]);

  // --- OCR ---
  const provider = new SwiftVisionOcrProvider({ binaryPath: OCR_BINARY_PATH });
  const ocrResult = await provider.recognize(imagePath);
  assert.equal(ocrResult.ok, true, ocrResult.error);

  // --- Queue construction ---
  const extraction = extractWorklistRowsFromOcrLines(ocrResult.lines);
  const worklistRows = buildWorklistRows(extraction.rows, "acceptance-import", "worklist.png");
  assert.equal(worklistRows.length, 5, JSON.stringify(worklistRows.map((r) => r.patientNameRaw)));

  const { targets, unresolved } = resolveQueueTargets(worklistRows, SYNTHETIC_SITE_ADAPTER.expectedAuthor);
  // "Wound Care Note" isn't a recognized category, so OCR/queue construction itself rejects it —
  // an unsupported form never even reaches the batch as a target.
  assert.equal(targets.length, 4);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0]?.reason, "form_category_not_identified");

  await withServer(async (base) => {
    const browser: Browser = await chromium.launch();
    try {
      const deps: BatchRunnerDeps = {
        baseUrl: base,
        identitySelectors: STANDARD_IDENTITY_SELECTORS,
        expectedAuthor: SYNTHETIC_SITE_ADAPTER.expectedAuthor,
        openNewPage: () => browser.newPage(),
        closePage: (page) => page.close(),
        formAdapterFor: (formType, formVersion) => {
          if (formType === SNV_V1_ADAPTER.formType && formVersion === SNV_V1_ADAPTER.formVersion) return SNV_V1_ADAPTER;
          if (formType === RECERT_V1_ADAPTER.formType && formVersion === RECERT_V1_ADAPTER.formVersion) return RECERT_V1_ADAPTER;
          return undefined;
        },
        formVersionFor: (formType) => {
          if (formType === SNV_V1_ADAPTER.formType) return SNV_V1_ADAPTER.formVersion;
          if (formType === RECERT_V1_ADAPTER.formType) return RECERT_V1_ADAPTER.formVersion;
          return undefined;
        },
        redLinkSectionsFor: (formType, _v, pageIndex) => (formType === RECERT_V1_ADAPTER.formType && pageIndex === 1 ? RECERT_V1_RED_LINK_CONFIGS : []),
        draftSaveConfigFor: () => SAVE_CONFIG,
        patientIdFor: (criteria) => {
          const byName: Record<string, string> = {
            "Rehearsal Alpha": "pat-1",
            "Rehearsal Bravo": "pat-2",
            "Rehearsal Charlie": "pat-3",
            "Rehearsal Delta": "pat-4"
          };
          return byName[criteria.patient];
        }
      };

      // --- Batch: pending form -> predecessor -> supported pages -> configured updates -> saved drafts ---
      const result = await runBatch(targets, deps);

      assert.deepEqual(result.completed.sort(), targets.filter((t) => ["Rehearsal Alpha", "Rehearsal Bravo"].includes(t.criteria.patient)).map((t) => t.queueEntryId).sort());
      assert.equal(result.needsReview.length, 2, "Charlie (ambiguous predecessor) and Delta (no qualifying predecessor) both need RN review");
      assert.equal(result.blocked.length, 0);

      // --- Completion summary (what the desktop Dashboard screen surfaces) ---
      const summary = {
        draftsCompleted: result.completed.length,
        pagesSaved: result.completed.length * 2, // both SNV and Recert adapters have 2 pages each
        itemsNeedingReview: result.needsReview.length,
        unsupportedForms: unresolved.filter((u) => u.reason === "form_category_not_identified").length
      };
      assert.deepEqual(summary, { draftsCompleted: 2, pagesSaved: 4, itemsNeedingReview: 2, unsupportedForms: 1 });

      for (const exc of result.exceptions) {
        assert.doesNotMatch(exc.nonclinicalDetail, /Rehearsal|SYN-\d{4}|\d{2}\/\d{2}\/\d{4}/, "exceptions must stay nonclinical");
      }
    } finally {
      await browser.close();
    }
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
