import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCsvRows,
  parseWorklistCsv,
  parseFlexibleDate,
  extractWorklistRowsFromOcrLines,
  buildWorklistRows,
  sortByDaysOutstandingDescending,
  sortOriginalOrder,
  FixedOcrProvider
} from "@rn-doc-runner/queue-engine";

test("CSV parser handles quoted fields, embedded commas, and escaped quotes", () => {
  const rows = parseCsvRows('patient,note\n"Doe, Jane","Says ""hello"""\nPlain,Value');
  assert.deepEqual(rows, [
    ["patient", "note"],
    ["Doe, Jane", 'Says "hello"'],
    ["Plain", "Value"]
  ]);
});

test("parseWorklistCsv requires patient and date columns and reports missing ones", () => {
  const result = parseWorklistCsv("form,category\nA,B");
  assert.deepEqual(result.rows, []);
  assert.ok(result.errors.includes("missing_required_column:patient"));
  assert.ok(result.errors.includes("missing_required_column:date"));
});

test("parseWorklistCsv extracts rows regardless of header column order/case", () => {
  const result = parseWorklistCsv("Category,Patient,Date,Days Outstanding\nSkilled Nurse Visit Note,Synthetic One,07/20/2026,5");
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], {
    patient: "Synthetic One",
    date: "07/20/2026",
    daysOutstanding: 5,
    category: "Skilled Nurse Visit Note"
  });
});

test("parseFlexibleDate normalizes slash, dash, and ISO forms to zero-padded MM/DD/YYYY (matching the EHR's own displayed format), and rejects invalid dates", () => {
  assert.equal(parseFlexibleDate("7/20/2026"), "07/20/2026");
  assert.equal(parseFlexibleDate("07-20-2026"), "07/20/2026");
  assert.equal(parseFlexibleDate("2026-07-20"), "07/20/2026");
  assert.equal(parseFlexibleDate("13/40/2026"), null);
  assert.equal(parseFlexibleDate("not a date"), null);
});

test("extractWorklistRowsFromOcrLines reconstructs rows from raw OCR text and skips headers/noise", () => {
  const result = extractWorklistRowsFromOcrLines([
    { text: "RN DOC Runner Synthetic Worklist", confidence: 0.99 },
    { text: "Patient", confidence: 0.95 },
    { text: "Synthetic Patient One 07/20/2026 5 Skilled Nurse Visit Note", confidence: 0.97 },
    { text: "Synthetic Patient Two 07/18/2026 7 OASIS/Nurse Recert", confidence: 0.93 }
  ]);
  assert.equal(result.skippedLineCount, 2);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]?.patientNameRaw, "Synthetic Patient One");
  assert.equal(result.rows[0]?.formDateNormalized, "07/20/2026");
  assert.equal(result.rows[0]?.daysOutstanding, 5);
  assert.equal(result.rows[0]?.formCategory, "Skilled Nurse Visit Note");
  assert.equal(result.rows[1]?.formCategory, "OASIS/Nurse Recert");
});

test("buildWorklistRows marks exact patient/date/category duplicates and preserves original order", () => {
  const rows = buildWorklistRows(
    [
      { patientNameRaw: "Synthetic A", formDateRaw: "07/20/2026", formDateNormalized: "7/20/2026", daysOutstanding: 5, formCategory: "Skilled Nurse Visit Note", confidence: 0.9 },
      { patientNameRaw: "Synthetic B", formDateRaw: "07/18/2026", formDateNormalized: "7/18/2026", daysOutstanding: 10, formCategory: "OASIS/Nurse Recert", confidence: 0.9 },
      { patientNameRaw: "Synthetic A", formDateRaw: "07/20/2026", formDateNormalized: "7/20/2026", daysOutstanding: 5, formCategory: "Skilled Nurse Visit Note", confidence: 0.6 }
    ],
    "import-1",
    "file-1"
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0]?.duplicateOfRowId, undefined);
  assert.equal(rows[2]?.duplicateOfRowId, rows[0]?.id);

  const byPriority = sortByDaysOutstandingDescending(rows);
  assert.equal(byPriority[0]?.patientNameRaw, "Synthetic B");

  const original = sortOriginalOrder([...rows].reverse());
  assert.deepEqual(original.map((r) => r.rowOrder), [0, 1, 2]);
});

test("FixedOcrProvider returns a deterministic result without touching a subprocess", async () => {
  const provider = new FixedOcrProvider({ ok: true, lines: [{ text: "hello", confidence: 1 }] });
  const result = await provider.recognize("/nonexistent/path.png");
  assert.equal(result.ok, true);
  assert.equal(result.lines[0]?.text, "hello");
});
