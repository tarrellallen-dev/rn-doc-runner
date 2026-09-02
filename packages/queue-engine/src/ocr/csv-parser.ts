/** Minimal RFC4180-ish CSV parser: quoted fields, escaped "" quotes, CRLF/LF rows. No external dependency. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      endField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) endRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export interface WorklistCsvRow {
  patient: string;
  date: string;
  daysOutstanding?: number;
  category?: string;
}

export interface CsvParseResult {
  rows: WorklistCsvRow[];
  errors: string[];
}

const REQUIRED_HEADERS = ["patient", "date"] as const;

/** Expects a header row (patient, date[, daysoutstanding][, category]) in any column order/case. */
export function parseWorklistCsv(text: string): CsvParseResult {
  const table = parseCsvRows(text);
  if (table.length === 0) return { rows: [], errors: ["empty_csv"] };

  const header = table[0]!.map((h) => h.trim().toLowerCase().replace(/[\s_]+/g, ""));
  const errors: string[] = [];
  for (const required of REQUIRED_HEADERS) {
    if (!header.includes(required)) errors.push(`missing_required_column:${required}`);
  }
  if (errors.length) return { rows: [], errors };

  const patientIndex = header.indexOf("patient");
  const dateIndex = header.indexOf("date");
  const daysIndex = header.indexOf("daysoutstanding");
  const categoryIndex = header.indexOf("category");

  const rows: WorklistCsvRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const record = table[r]!;
    const patient = record[patientIndex]?.trim();
    const date = record[dateIndex]?.trim();
    if (!patient || !date) {
      errors.push(`row_${r}_missing_required_field`);
      continue;
    }
    const daysRaw = daysIndex >= 0 ? record[daysIndex]?.trim() : undefined;
    const days = daysRaw ? Number(daysRaw) : undefined;
    rows.push({
      patient,
      date,
      daysOutstanding: days !== undefined && Number.isFinite(days) ? days : undefined,
      category: categoryIndex >= 0 ? record[categoryIndex]?.trim() || undefined : undefined
    });
  }
  return { rows, errors };
}
