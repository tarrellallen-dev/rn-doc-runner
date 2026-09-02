import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  SwiftVisionOcrProvider,
  extractWorklistRowsFromOcrLines,
  buildWorklistRows,
  sortByDaysOutstandingDescending
} from "@rn-doc-runner/queue-engine";

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const BINARY_PATH = path.join(PROJECT_ROOT, "ocr-helper/.build/release/ocr-helper");

test("synthetic worklist image -> on-device OCR -> reconstructed, prioritized, duplicate-checked queue rows (Task 4 acceptance path)", async (t) => {
  if (!fs.existsSync(BINARY_PATH)) {
    t.skip(`ocr-helper not built at ${BINARY_PATH} — run "swift build -c release" in ocr-helper/`);
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-doc-runner-ocr-"));
  const rowsPath = path.join(tmpDir, "rows.json");
  const imagePath = path.join(tmpDir, "worklist.png");

  const syntheticRows = [
    { patient: "Synthetic Patient Alpha", date: "07/20/2026", daysOutstanding: 5, category: "Skilled Nurse Visit Note" },
    { patient: "Synthetic Patient Bravo", date: "07/10/2026", daysOutstanding: 15, category: "OASIS/Nurse Recert" },
    { patient: "Synthetic Patient Charlie", date: "07/25/2026", daysOutstanding: 2, category: "Skilled Nurse Visit Note" }
  ];
  fs.writeFileSync(rowsPath, JSON.stringify(syntheticRows));

  const generate = await execFileAsync(BINARY_PATH, ["generate-worklist", imagePath, rowsPath]);
  const generateResult = JSON.parse(generate.stdout);
  assert.equal(generateResult.ok, true);
  assert.ok(fs.existsSync(imagePath));

  const provider = new SwiftVisionOcrProvider({ binaryPath: BINARY_PATH });
  const ocrResult = await provider.recognize(imagePath);
  assert.equal(ocrResult.ok, true, ocrResult.error);
  assert.ok(ocrResult.lines.length > 0, "expected at least one recognized line");

  const extraction = extractWorklistRowsFromOcrLines(ocrResult.lines);
  assert.equal(extraction.rows.length, 3, `expected 3 reconstructed rows, got ${JSON.stringify(extraction.rows)}`);

  const worklistRows = buildWorklistRows(
    extraction.rows.map((r) => ({ ...r, confidence: r.confidence })),
    "import-e2e",
    "file-e2e"
  );
  assert.equal(worklistRows.every((r) => r.duplicateOfRowId === undefined), true);

  const prioritized = sortByDaysOutstandingDescending(worklistRows);
  assert.equal(prioritized[0]?.patientNameRaw, "Synthetic Patient Bravo");
  assert.equal(prioritized[0]?.daysOutstanding, 15);
  assert.equal(prioritized[2]?.patientNameRaw, "Synthetic Patient Charlie");

  for (const row of worklistRows) {
    assert.ok(row.formDateNormalized, `${row.patientNameRaw} should have a normalized date`);
    assert.ok(row.confidence > 0 && row.confidence <= 1);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
