/**
 * Phase 2 / Task 4 extension: PDF and HEIC worklist import. Every test
 * here drives the REAL Swift/Vision binary end to end against synthetic,
 * patient-free fixtures generated on the fly — no real photographs or
 * PDFs are used anywhere in this file.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SwiftVisionOcrProvider, importWorklistFromPdf } from "@rn-doc-runner/queue-engine";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const BINARY_PATH = path.join(PROJECT_ROOT, "ocr-helper/.build/release/ocr-helper");

function requireBinary(t: { skip: (msg: string) => void }): boolean {
  if (!fs.existsSync(BINARY_PATH)) {
    t.skip(`ocr-helper not built at ${BINARY_PATH} — run "swift build -c release" in ocr-helper/`);
    return false;
  }
  return true;
}

test("multi-page PDF worklist import: every row carries its source page number, in page order, across all pages", async (t) => {
  if (!requireBinary(t)) return;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-doc-runner-pdf-"));
  const rowsPath = path.join(tmpDir, "rows.json");
  const pdfPath = path.join(tmpDir, "worklist.pdf");

  const syntheticRows = [
    { patient: "Synthetic Patient One", date: "07/20/2026", daysOutstanding: 5, category: "Skilled Nurse Visit Note" },
    { patient: "Synthetic Patient Two", date: "07/18/2026", daysOutstanding: 7, category: "OASIS/Nurse Recert" },
    { patient: "Synthetic Patient Three", date: "07/25/2026", daysOutstanding: 2, category: "Med Admin Skilled Nurse Visit Record" },
    { patient: "Synthetic Patient Four", date: "07/22/2026", daysOutstanding: 9, category: "Skilled Nurse Visit Note" }
  ];
  fs.writeFileSync(rowsPath, JSON.stringify(syntheticRows));
  const generate = await execFileAsync(BINARY_PATH, ["generate-worklist-pdf", pdfPath, rowsPath, "2"]);
  const generateResult = JSON.parse(generate.stdout);
  assert.equal(generateResult.ok, true);
  assert.equal(generateResult.pages, 2, "4 rows at 2/page must produce exactly 2 pages");

  const provider = new SwiftVisionOcrProvider({ binaryPath: BINARY_PATH });
  const result = await importWorklistFromPdf(provider, pdfPath, "import-pdf-1", "worklist.pdf");

  assert.equal(result.ok, true, result.error);
  assert.equal(result.pageCount, 2);
  assert.equal(result.rows.length, 4, JSON.stringify(result.rows.map((r) => r.patientNameRaw)));

  const page1Rows = result.rows.filter((r) => r.sourcePageNumber === 1);
  const page2Rows = result.rows.filter((r) => r.sourcePageNumber === 2);
  assert.equal(page1Rows.length, 2);
  assert.equal(page2Rows.length, 2);
  assert.deepEqual(page1Rows.map((r) => r.patientNameRaw).sort(), ["Synthetic Patient One", "Synthetic Patient Two"]);
  assert.deepEqual(page2Rows.map((r) => r.patientNameRaw).sort(), ["Synthetic Patient Four", "Synthetic Patient Three"]);
  // rowOrder must preserve overall page order (page 1's rows before page 2's).
  assert.ok(Math.max(...page1Rows.map((r) => r.rowOrder)) < Math.min(...page2Rows.map((r) => r.rowOrder)));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("a genuinely password-protected PDF fails safely (pdf_encrypted), never guessing a password", async (t) => {
  if (!requireBinary(t)) return;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-doc-runner-pdf-enc-"));
  const pdfPath = path.join(tmpDir, "encrypted.pdf");
  await execFileAsync(BINARY_PATH, ["generate-encrypted-pdf", pdfPath, "s3cret-test-password"]);

  const provider = new SwiftVisionOcrProvider({ binaryPath: BINARY_PATH });
  const result = await importWorklistFromPdf(provider, pdfPath, "import-pdf-enc", "encrypted.pdf");

  assert.equal(result.ok, false);
  assert.equal(result.error, "pdf_encrypted");
  assert.deepEqual(result.rows, []);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("a corrupted/unreadable PDF fails safely instead of throwing", async (t) => {
  if (!requireBinary(t)) return;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-doc-runner-pdf-corrupt-"));
  const pdfPath = path.join(tmpDir, "corrupted.pdf");
  fs.writeFileSync(pdfPath, "this is not a real pdf, just garbage bytes with the right extension");

  const provider = new SwiftVisionOcrProvider({ binaryPath: BINARY_PATH });
  const result = await importWorklistFromPdf(provider, pdfPath, "import-pdf-corrupt", "corrupted.pdf");

  assert.equal(result.ok, false);
  assert.equal(result.error, "pdf_load_failed");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("a missing PDF file fails safely with pdf_not_found", async (t) => {
  if (!requireBinary(t)) return;
  const provider = new SwiftVisionOcrProvider({ binaryPath: BINARY_PATH });
  const result = await importWorklistFromPdf(provider, "/nonexistent/path/does-not-exist.pdf", "import-pdf-missing", "missing.pdf");
  assert.equal(result.ok, false);
  assert.equal(result.error, "pdf_not_found");
});

test("HEIC worklist images are recognized correctly through the same on-device pipeline as PNG/JPEG", async (t) => {
  if (!requireBinary(t)) return;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-doc-runner-heic-"));
  const rowsPath = path.join(tmpDir, "rows.json");
  const pngPath = path.join(tmpDir, "worklist.png");
  const heicPath = path.join(tmpDir, "worklist.heic");

  const syntheticRows = [{ patient: "Synthetic Patient Heic", date: "07/21/2026", daysOutstanding: 4, category: "Skilled Nurse Visit Note" }];
  fs.writeFileSync(rowsPath, JSON.stringify(syntheticRows));
  await execFileAsync(BINARY_PATH, ["generate-worklist", pngPath, rowsPath]);
  const convert = await execFileAsync(BINARY_PATH, ["convert", pngPath, heicPath]);
  assert.equal(JSON.parse(convert.stdout).ok, true);
  assert.ok(fs.existsSync(heicPath));

  const provider = new SwiftVisionOcrProvider({ binaryPath: BINARY_PATH });
  const result = await provider.recognize(heicPath);
  assert.equal(result.ok, true, result.error);
  const combinedText = result.lines.map((l) => l.text).join(" ");
  assert.match(combinedText, /Synthetic Patient Heic/);
  assert.match(combinedText, /07\/21\/2026/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("a missing/nonexistent image (any format) fails safely instead of throwing", async (t) => {
  if (!requireBinary(t)) return;
  const provider = new SwiftVisionOcrProvider({ binaryPath: BINARY_PATH });
  const result = await provider.recognize("/nonexistent/path/does-not-exist.heic");
  assert.equal(result.ok, false);
  assert.equal(result.error, "image_load_failed");
});

test("renderPdfPage rasterizes a single named page to a standalone PNG (Import Review preview)", async (t) => {
  if (!requireBinary(t)) return;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-doc-runner-pdf-preview-"));
  const rowsPath = path.join(tmpDir, "rows.json");
  const pdfPath = path.join(tmpDir, "worklist.pdf");
  const previewPath = path.join(tmpDir, "page-2.png");

  const syntheticRows = [
    { patient: "Synthetic Patient One", date: "07/20/2026", daysOutstanding: 5, category: "Skilled Nurse Visit Note" },
    { patient: "Synthetic Patient Two", date: "07/18/2026", daysOutstanding: 7, category: "OASIS/Nurse Recert" }
  ];
  fs.writeFileSync(rowsPath, JSON.stringify(syntheticRows));
  await execFileAsync(BINARY_PATH, ["generate-worklist-pdf", pdfPath, rowsPath, "1"]);

  const provider = new SwiftVisionOcrProvider({ binaryPath: BINARY_PATH });
  const result = await provider.renderPdfPage(pdfPath, 2, previewPath);
  assert.equal(result.ok, true, result.error);
  assert.ok(fs.existsSync(previewPath));
  assert.ok(fs.statSync(previewPath).size > 0);

  const outOfRange = await provider.renderPdfPage(pdfPath, 99, previewPath);
  assert.equal(outOfRange.ok, false);
  assert.equal(outOfRange.error, "pdf_page_out_of_range");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("convertImage turns a HEIC source into a PNG the desktop preview panel can render", async (t) => {
  if (!requireBinary(t)) return;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-doc-runner-convert-"));
  const rowsPath = path.join(tmpDir, "rows.json");
  const pngPath = path.join(tmpDir, "worklist.png");
  const heicPath = path.join(tmpDir, "worklist.heic");
  const previewPath = path.join(tmpDir, "preview.png");

  fs.writeFileSync(rowsPath, JSON.stringify([{ patient: "Synthetic Patient Heic", date: "07/21/2026", daysOutstanding: 4, category: "Skilled Nurse Visit Note" }]));
  await execFileAsync(BINARY_PATH, ["generate-worklist", pngPath, rowsPath]);
  await execFileAsync(BINARY_PATH, ["convert", pngPath, heicPath]);

  const provider = new SwiftVisionOcrProvider({ binaryPath: BINARY_PATH });
  const result = await provider.convertImage(heicPath, previewPath);
  assert.equal(result.ok, true, result.error);
  assert.ok(fs.existsSync(previewPath));

  const missing = await provider.convertImage("/nonexistent/does-not-exist.heic", previewPath);
  assert.equal(missing.ok, false);
  assert.equal(missing.error, "image_load_failed");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
