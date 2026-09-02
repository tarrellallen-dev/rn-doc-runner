/**
 * Import Review screen (Phase 2 / Task P2-1): the one nontechnical
 * review step between "Add Worklist" and "Confirm Queue". Shows every
 * OCR-extracted row next to a preview of the source photo/PDF page it
 * came from, lets the RN correct a misread patient name/date/form
 * type, remove a row OCR mis-detected entirely, or add one it missed —
 * and blocks Confirm Queue until every remaining row has what it needs
 * to be queued.
 *
 * Deliberately does not import anything from @rn-doc-runner/queue-engine:
 * that package's OCR provider shells out via node:child_process, which
 * cannot be bundled into this browser-target renderer. The small pieces
 * of matching logic needed here (known form categories, date
 * normalization, duplicate detection) are self-contained below,
 * mirroring packages/queue-engine/src/ocr/{ocr-line-parser,
 * date-normalize,queue-builder}.ts. The authoritative versions still run
 * server-side (main process) at Confirm Queue time.
 */
import { useEffect, useMemo, useState } from "react";
import type { WorklistRow } from "@rn-doc-runner/contracts";
import type { UnresolvedQueueRow } from "../../main/resolve-queue-targets.js";
import { ErrorNote } from "../ErrorNote.js";
import { humanize } from "../humanize.js";

export const KNOWN_FORM_CATEGORIES = ["Skilled Nurse Visit Note", "OASIS/Nurse Recert", "Med Admin Skilled Nurse Visit Record"];

const LOW_CONFIDENCE_THRESHOLD = 0.7;

/** UI-convenience formatter only — the safety-critical strict parser used for the live-EHR identity match lives in @rn-doc-runner/rules. */
function normalizeDateInput(raw: string): string | null {
  const trimmed = raw.trim();
  const slashOrDash = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const match = slashOrDash ?? iso;
  if (!match) return null;
  const [month, day, year] = slashOrDash ? [Number(match[1]), Number(match[2]), Number(match[3])] : [Number(match[2]), Number(match[3]), Number(match[1])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`;
}

function duplicateKey(row: WorklistRow): string {
  return `${row.patientNameRaw.toLowerCase().trim()}::${row.formDateNormalized ?? row.formDateRaw}::${(row.formCategory ?? "").toLowerCase()}`;
}

/** Recomputes duplicateOfRowId after an edit could have changed which rows now collide. */
function recomputeDuplicates(rows: WorklistRow[]): WorklistRow[] {
  const firstSeenId = new Map<string, string>();
  return rows.map((row) => {
    const key = duplicateKey(row);
    const first = firstSeenId.get(key);
    if (first) return { ...row, duplicateOfRowId: first };
    firstSeenId.set(key, row.id);
    return { ...row, duplicateOfRowId: undefined };
  });
}

function rowIssues(row: WorklistRow): string[] {
  const issues: string[] = [];
  if (!row.patientNameRaw.trim()) issues.push("Patient name is required");
  if (!row.formDateNormalized) issues.push("Form date needs correction");
  if (!row.formCategory) issues.push("Form type needs selection");
  if (row.duplicateOfRowId) issues.push("Duplicate of another row");
  return issues;
}

type SortKey = "daysOutstanding" | "patientName" | "confidence";
type FilterKey = "all" | "needsAttention" | "lowConfidence";

export interface ImportedSourceFile {
  path: string;
  kind: "image" | "pdf";
}

export function ImportReviewScreen({
  rows,
  onRowsChange,
  unresolved,
  importedFile,
  onConfirm
}: {
  rows: WorklistRow[];
  onRowsChange: (rows: WorklistRow[]) => void;
  unresolved: UnresolvedQueueRow[];
  importedFile: ImportedSourceFile | null;
  onConfirm: () => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("daysOutstanding");
  const [filterKey, setFilterKey] = useState<FilterKey>("all");
  const [showRemoved, setShowRemoved] = useState(false);
  const [selectedRowId, setSelectedRowId] = useState<string | undefined>(rows[0]?.id);
  const [preview, setPreview] = useState<{ dataUrl?: string; error?: string; loading: boolean }>({ loading: false });

  const selectedRow = rows.find((r) => r.id === selectedRowId);

  useEffect(() => {
    if (!selectedRowId && rows.length > 0) setSelectedRowId(rows[0]?.id);
  }, [rows, selectedRowId]);

  useEffect(() => {
    if (!selectedRow || !importedFile) {
      setPreview({ loading: false });
      return;
    }
    let cancelled = false;
    setPreview({ loading: true });
    window.rnDocRunner
      .previewRow({ sourcePath: importedFile.path, sourceKind: importedFile.kind, pageNumber: selectedRow.sourcePageNumber ?? 1 })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) setPreview({ loading: false, error: result.error ?? "preview_failed" });
        else setPreview({ loading: false, dataUrl: result.dataUrl });
      })
      .catch((error) => {
        if (!cancelled) setPreview({ loading: false, error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRow?.id, selectedRow?.sourcePageNumber, importedFile]);

  function updateRow(id: string, patch: Partial<WorklistRow>): void {
    const next = rows.map((row) => (row.id === id ? { ...row, ...patch, manuallyCorrected: true } : row));
    onRowsChange(recomputeDuplicates(next));
  }

  function removeRow(id: string): void {
    onRowsChange(rows.map((row) => (row.id === id ? { ...row, removed: true } : row)));
  }

  function restoreRow(id: string): void {
    onRowsChange(recomputeDuplicates(rows.map((row) => (row.id === id ? { ...row, removed: false } : row))));
  }

  function clearDuplicateFlag(id: string): void {
    onRowsChange(rows.map((row) => (row.id === id ? { ...row, duplicateOfRowId: undefined, manuallyCorrected: true } : row)));
  }

  function addRow(): void {
    const template = rows[0];
    const nextOrder = rows.reduce((max, r) => Math.max(max, r.rowOrder), -1) + 1;
    const newRow: WorklistRow = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      importId: template?.importId ?? `import-manual-${Date.now()}`,
      sourceFileId: template?.sourceFileId ?? "manual-entry",
      patientNameRaw: "",
      formDateRaw: "",
      formDateNormalized: undefined,
      formCategory: undefined,
      confidence: 1,
      rotationCorrected: false,
      manuallyCorrected: true,
      removed: false,
      rowOrder: nextOrder
    };
    onRowsChange([...rows, newRow]);
    setSelectedRowId(newRow.id);
  }

  const visibleRows = useMemo(() => {
    let list = rows.filter((row) => showRemoved || !row.removed);
    if (filterKey === "needsAttention") list = list.filter((row) => row.removed || rowIssues(row).length > 0);
    if (filterKey === "lowConfidence") list = list.filter((row) => row.removed || row.confidence < LOW_CONFIDENCE_THRESHOLD);
    const sorted = [...list].sort((a, b) => {
      if (sortKey === "patientName") return a.patientNameRaw.localeCompare(b.patientNameRaw);
      if (sortKey === "confidence") return a.confidence - b.confidence;
      return (b.daysOutstanding ?? -1) - (a.daysOutstanding ?? -1);
    });
    return sorted;
  }, [rows, filterKey, showRemoved, sortKey]);

  const activeRows = rows.filter((row) => !row.removed);
  const blockingRowCount = activeRows.filter((row) => rowIssues(row).length > 0).length;
  const canConfirm = activeRows.length > 0 && blockingRowCount === 0;

  return (
    <section>
      <h2>Review Queue</h2>
      <p>Check what was read from your worklist before starting the batch. Correct anything wrong, remove anything OCR mis-detected, and add anything it missed.</p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <label>
          Sort by:{" "}
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="daysOutstanding">Days outstanding</option>
            <option value="patientName">Patient name</option>
            <option value="confidence">Confidence (lowest first)</option>
          </select>
        </label>
        <label>
          Show:{" "}
          <select value={filterKey} onChange={(e) => setFilterKey(e.target.value as FilterKey)}>
            <option value="all">All rows</option>
            <option value="needsAttention">Needs attention only</option>
            <option value="lowConfidence">Low confidence only</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> Show removed rows
        </label>
        <button onClick={addRow}>Add Row</button>
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1, overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 780, borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 190 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 220 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 240 }} />
            <col style={{ width: 90 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={thStyle}>Patient</th>
              <th style={thStyle}>Form Date</th>
              <th style={thStyle}>Days Outstanding</th>
              <th style={thStyle}>Form Type</th>
              <th style={thStyle}>Confidence</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const issues = rowIssues(row);
              const lowConfidence = row.confidence < LOW_CONFIDENCE_THRESHOLD;
              return (
                <tr
                  key={row.id}
                  onClick={() => setSelectedRowId(row.id)}
                  style={{
                    background: row.id === selectedRowId ? "#eef1f0" : row.removed ? "#f4f4f4" : undefined,
                    opacity: row.removed ? 0.55 : 1,
                    cursor: "pointer"
                  }}
                >
                  <td style={tdStyle}>
                    <input
                      value={row.patientNameRaw}
                      disabled={row.removed}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateRow(row.id, { patientNameRaw: e.target.value })}
                      style={inputStyle}
                    />
                  </td>
                  <td style={tdStyle}>
                    <input
                      value={row.formDateRaw}
                      disabled={row.removed}
                      placeholder="MM/DD/YYYY"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        updateRow(row.id, { formDateRaw: e.target.value, formDateNormalized: normalizeDateInput(e.target.value) ?? undefined })
                      }
                      style={inputStyle}
                    />
                  </td>
                  <td style={tdStyle}>
                    <input
                      type="number"
                      min={0}
                      value={row.daysOutstanding ?? ""}
                      disabled={row.removed}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateRow(row.id, { daysOutstanding: e.target.value === "" ? undefined : Number(e.target.value) })}
                      style={{ ...inputStyle, width: 70 }}
                    />
                  </td>
                  <td style={tdStyle}>
                    <select
                      value={row.formCategory ?? ""}
                      disabled={row.removed}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateRow(row.id, { formCategory: e.target.value || undefined })}
                      style={inputStyle}
                    >
                      <option value="">Not identified</option>
                      {KNOWN_FORM_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={tdStyle}>
                    {Math.round(row.confidence * 100)}%{lowConfidence && !row.removed && <span style={lowConfidenceBadgeStyle}>Low confidence</span>}
                  </td>
                  <td style={tdStyle}>
                    {row.removed ? (
                      <em>Removed</em>
                    ) : issues.length > 0 ? (
                      <span style={{ color: "#9f1239" }}>{issues.join("; ")}</span>
                    ) : (
                      <span style={{ color: "#2f6b5c" }}>Ready</span>
                    )}
                    {row.duplicateOfRowId && !row.removed && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          clearDuplicateFlag(row.id);
                        }}
                        style={{ marginLeft: 6 }}
                      >
                        Not a duplicate
                      </button>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {row.removed ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          restoreRow(row.id);
                        }}
                      >
                        Undo
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRow(row.id);
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        <aside style={previewPanelStyle}>
          <h3 style={{ marginTop: 0 }}>Source Preview</h3>
          {!importedFile && <p>No document preview available for a CSV-imported worklist.</p>}
          {importedFile && !selectedRow && <p>Select a row to preview its source.</p>}
          {importedFile && selectedRow && preview.loading && <p>Loading preview…</p>}
          {importedFile && selectedRow && preview.error && <ErrorNote code={preview.error} />}
          {importedFile && selectedRow && preview.dataUrl && (
            <img src={preview.dataUrl} alt="Source worklist page for the selected row" style={{ maxWidth: "100%", border: "1px solid #ddd" }} />
          )}
          {selectedRow?.sourcePageNumber && <p style={{ fontSize: 12, color: "#6b6b6b" }}>Page {selectedRow.sourcePageNumber}</p>}
        </aside>
      </div>

      <p style={{ marginTop: 16 }}>
        <button onClick={onConfirm} disabled={!canConfirm}>
          Confirm Queue
        </button>
        {!canConfirm && activeRows.length > 0 && (
          <span style={{ marginLeft: 8, color: "#9f1239" }}>
            {blockingRowCount} row(s) still need attention before you can confirm.
          </span>
        )}
        {activeRows.length === 0 && <span style={{ marginLeft: 8, color: "#9f1239" }}>Add at least one row before confirming.</span>}
      </p>

      {unresolved.length > 0 && (
        <div>
          <h3>Needs attention before queuing</h3>
          <ul>
            {unresolved.map((u) => {
              const row = rows.find((r) => r.id === u.worklistRowId);
              return (
                <li key={u.worklistRowId}>
                  {row?.patientNameRaw ?? "That row"}: {humanize(u.reason)}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

const thStyle: React.CSSProperties = { textAlign: "left", borderBottom: "2px solid #ddd", padding: "6px 8px" };
const tdStyle: React.CSSProperties = { borderBottom: "1px solid #eee", padding: "6px 8px", verticalAlign: "top" };
const inputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box" };
const lowConfidenceBadgeStyle: React.CSSProperties = {
  marginLeft: 6,
  fontSize: 11,
  color: "#92400e",
  background: "#fef3c7",
  borderRadius: 4,
  padding: "1px 6px"
};
const previewPanelStyle: React.CSSProperties = {
  width: 320,
  flexShrink: 0,
  background: "#fff",
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: 12,
  alignSelf: "flex-start",
  position: "sticky",
  top: 12
};
