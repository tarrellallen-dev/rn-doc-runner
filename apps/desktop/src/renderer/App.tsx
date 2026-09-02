import { useCallback, useEffect, useState } from "react";
import type { WorklistRow } from "@rn-doc-runner/contracts";
import type { QueueTarget } from "@rn-doc-runner/queue-engine";
import type { BatchProgressSnapshot, QueueEntryLabel } from "../shared/ipc-contract.js";
import type { UnresolvedQueueRow } from "../main/resolve-queue-targets.js";
import { ImportReviewScreen, type ImportedSourceFile } from "./screens/ImportReviewScreen.js";
import { ErrorNote } from "./ErrorNote.js";

type Screen = "home" | "import" | "running" | "completedDrafts" | "exceptions" | "settings";

const EMPTY_PROGRESS: BatchProgressSnapshot = { completed: [], needsReview: [], skipped: [], blocked: [], running: false };

export function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [worklistRows, setWorklistRows] = useState<WorklistRow[]>([]);
  const [queueTargets, setQueueTargets] = useState<QueueTarget[]>([]);
  const [unresolved, setUnresolved] = useState<UnresolvedQueueRow[]>([]);
  const [progress, setProgress] = useState<BatchProgressSnapshot>(EMPTY_PROGRESS);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [importError, setImportError] = useState<string>("");
  const [hasResumableState, setHasResumableState] = useState(false);
  const [importedFile, setImportedFile] = useState<ImportedSourceFile | null>(null);
  const [entryLabels, setEntryLabels] = useState<QueueEntryLabel[]>([]);

  useEffect(() => {
    return window.rnDocRunner.onBatchProgress((snapshot) => setProgress(snapshot));
  }, []);

  useEffect(() => {
    window.rnDocRunner.hasResumableState().then(setHasResumableState);
  }, [progress.running]);

  useEffect(() => {
    window.rnDocRunner.getEntryLabels().then(setEntryLabels);
  }, [progress]);

  const handleFileSelected = useCallback(async (file: File) => {
    setImportError("");
    try {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith(".csv")) {
        const text = await file.text();
        const result = await window.rnDocRunner.importWorklistCsv(text);
        if (result.errors.length) setImportError(result.errors.join(", "));
        setWorklistRows(result.rows);
        setImportedFile(null);
      } else if (lowerName.endsWith(".pdf")) {
        const pdfPath = window.rnDocRunnerFiles.getPathForFile(file);
        const result = await window.rnDocRunner.importWorklistPdf(pdfPath);
        if (result.error) setImportError(result.error);
        setWorklistRows(result.rows);
        setImportedFile({ path: pdfPath, kind: "pdf" });
      } else {
        const imagePath = window.rnDocRunnerFiles.getPathForFile(file);
        const result = await window.rnDocRunner.importWorklistImage(imagePath);
        if (result.error) setImportError(result.error);
        setWorklistRows(result.rows);
        setImportedFile({ path: imagePath, kind: "image" });
      }
      setScreen("import");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const handleConfirmQueue = useCallback(async () => {
    const result = await window.rnDocRunner.confirmQueue(worklistRows);
    setQueueTargets(result.targets);
    setUnresolved(result.unresolved);
    setStatusMessage(`${result.targets.length} document(s) queued; ${result.unresolved.length} need attention before they can be queued.`);
    setScreen("home");
  }, [worklistRows]);

  const handleStartBatch = useCallback(async () => {
    const result = await window.rnDocRunner.startBatch(queueTargets);
    if (!result.ok) {
      setStatusMessage(`Could not start batch: ${result.error}`);
      return;
    }
    setScreen("running");
  }, [queueTargets]);

  const handleResumeBatch = useCallback(async () => {
    const result = await window.rnDocRunner.resumeFromCheckpoint();
    if (!result.ok) {
      setStatusMessage(`Could not resume batch: ${result.error}`);
      return;
    }
    setScreen("running");
  }, []);

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <nav style={navStyle}>
        <h1 style={{ fontSize: 16 }}>RN DOC Runner</h1>
        <NavButton label="Home" active={screen === "home"} onClick={() => setScreen("home")} />
        <NavButton label="Running Batch" active={screen === "running"} onClick={() => setScreen("running")} />
        <NavButton label="Completed Drafts" active={screen === "completedDrafts"} onClick={() => setScreen("completedDrafts")} />
        <NavButton label="Exceptions" active={screen === "exceptions"} onClick={() => setScreen("exceptions")} />
        <NavButton label="Settings" active={screen === "settings"} onClick={() => setScreen("settings")} />
        <p style={{ fontSize: 11, color: "#6b6b6b", marginTop: "auto" }}>
          The RN remains responsible for current clinical facts, final review, signing, and submission.
        </p>
      </nav>
      <main style={{ flex: 1, padding: 24, overflow: "auto" }}>
        {statusMessage && <p style={{ background: "#eef1f0", padding: 10, borderRadius: 6 }}>{statusMessage}</p>}
        {screen === "home" && (
          <HomeScreen
            queueCount={queueTargets.length}
            onFileSelected={handleFileSelected}
            onStartBatch={handleStartBatch}
            importError={importError}
            hasResumableState={hasResumableState}
            onResumeBatch={handleResumeBatch}
          />
        )}
        {screen === "import" && (
          <ImportReviewScreen
            rows={worklistRows}
            onRowsChange={setWorklistRows}
            onConfirm={handleConfirmQueue}
            unresolved={unresolved}
            importedFile={importedFile}
          />
        )}
        {screen === "running" && <RunningBatchScreen progress={progress} />}
        {screen === "completedDrafts" && <CompletedDraftsScreen queueEntryIds={progress.completed} entryLabels={entryLabels} />}
        {screen === "exceptions" && (
          <ExceptionsScreen needsReview={progress.needsReview} skipped={progress.skipped} blocked={progress.blocked} entryLabels={entryLabels} />
        )}
        {screen === "settings" && <SettingsScreen />}
      </main>
    </div>
  );
}

const navStyle: React.CSSProperties = {
  width: 200,
  background: "#173d35",
  color: "#fff",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 8
};

function NavButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "8px 10px",
        borderRadius: 6,
        border: "none",
        background: active ? "#2f6b5c" : "transparent",
        color: "#fff",
        cursor: "pointer"
      }}
    >
      {label}
    </button>
  );
}

function HomeScreen(props: {
  queueCount: number;
  importError: string;
  onFileSelected: (file: File) => void;
  onStartBatch: () => void;
  hasResumableState: boolean;
  onResumeBatch: () => void;
}) {
  return (
    <section>
      <h2>Home</h2>
      <p>Add worklist photos, PDFs, or CSV files, review the extracted queue, then start the batch.</p>
      <label style={buttonLikeLabelStyle}>
        Add Worklist
        <input
          type="file"
          accept=".csv,.png,.jpg,.jpeg,.heic,.pdf"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) props.onFileSelected(file);
            e.target.value = "";
          }}
        />
      </label>
      {props.importError && <ErrorNote code={props.importError} />}
      <p style={{ display: "flex", gap: 8 }}>
        <button disabled={props.queueCount === 0} onClick={props.onStartBatch}>
          Start Batch ({props.queueCount} queued)
        </button>
        {props.hasResumableState && <button onClick={props.onResumeBatch}>Resume Batch</button>}
      </p>
    </section>
  );
}

const buttonLikeLabelStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "8px 14px",
  border: "1px solid #173d35",
  borderRadius: 6,
  cursor: "pointer",
  marginBottom: 12
};


function RunningBatchScreen({ progress }: { progress: BatchProgressSnapshot }) {
  return (
    <section>
      <h2>Running Batch</h2>
      <p>Current nonclinical stage: {progress.running ? "processing" : "idle"}. Latest entry: {progress.latestQueueEntryId ?? "—"}</p>
      <div style={{ display: "flex", gap: 16 }}>
        <Stat label="Completed" value={progress.completed.length} />
        <Stat label="Needs Review" value={progress.needsReview.length} />
        <Stat label="Skipped" value={progress.skipped.length} />
        <Stat label="Blocked" value={progress.blocked.length} />
      </div>
      <div style={{ marginTop: 20, display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={() => window.rnDocRunner.pauseBatch()}>Pause</button>
        <button onClick={() => window.rnDocRunner.unpauseBatch()}>Resume</button>
        <button style={{ color: "#9f1239", fontWeight: 600 }} onClick={() => window.rnDocRunner.emergencyStop()}>
          Stop
        </button>
        <span style={{ fontSize: 12, color: "#6b6b6b" }}>Stops immediately, even mid-document. Nothing already saved is undone.</span>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 14, minWidth: 100 }}>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#6b6b6b" }}>{label}</div>
    </div>
  );
}

function entryDisplayName(queueEntryId: string, entryLabels: QueueEntryLabel[]): string {
  const label = entryLabels.find((l) => l.queueEntryId === queueEntryId);
  return label ? `${label.patient} — ${label.form} (${label.date})` : queueEntryId;
}

function OpenDraftForReviewButton({ queueEntryId }: { queueEntryId: string }) {
  const [error, setError] = useState<string>("");
  return (
    <>
      <button
        onClick={async () => {
          setError("");
          try {
            const result = await window.rnDocRunner.openDraftForReview(queueEntryId);
            if (!result.ok) setError(result.error ?? "open_draft_for_review_failed");
          } catch (error) {
            setError(error instanceof Error ? error.message : "open_draft_for_review_failed");
          }
        }}
      >
        Open Draft for Review
      </button>
      {error && <ErrorNote code={error} />}
    </>
  );
}

function CompletedDraftsScreen({ queueEntryIds, entryLabels }: { queueEntryIds: string[]; entryLabels: QueueEntryLabel[] }) {
  return (
    <section>
      <h2>Completed Drafts</h2>
      <p>
        RN DOC Runner filled in and saved these as editable drafts — nothing here has been signed or submitted. Open one to finish reviewing and
        sign it yourself in the record system.
      </p>
      {queueEntryIds.length === 0 && <p>No completed drafts yet.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {queueEntryIds.map((id) => (
          <li key={id} style={rowCardStyle}>
            <span>{entryDisplayName(id, entryLabels)}</span>
            <OpenDraftForReviewButton queueEntryId={id} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExceptionsScreen({
  needsReview,
  skipped,
  blocked,
  entryLabels
}: {
  needsReview: string[];
  skipped: string[];
  blocked: string[];
  entryLabels: QueueEntryLabel[];
}) {
  const groups: { title: string; ids: string[]; note: string }[] = [
    { title: "Needs Review", ids: needsReview, note: "RN DOC Runner couldn't confirm the outcome — check this one yourself." },
    { title: "Skipped", ids: skipped, note: "RN DOC Runner didn't touch this one — something didn't match what was expected." },
    { title: "Blocked", ids: blocked, note: "RN DOC Runner stopped before making any change, to be safe." }
  ];
  const total = needsReview.length + skipped.length + blocked.length;
  return (
    <section>
      <h2>Exceptions</h2>
      <p>Items RN DOC Runner couldn't safely finish on its own. Open one to look at it, or finish it yourself in the record system.</p>
      {total === 0 && <p>No exceptions right now.</p>}
      {groups.map(
        (group) =>
          group.ids.length > 0 && (
            <div key={group.title} style={{ marginBottom: 20 }}>
              <h3>
                {group.title} ({group.ids.length})
              </h3>
              <p style={{ fontSize: 12, color: "#6b6b6b", marginTop: -4 }}>{group.note}</p>
              <ul style={{ listStyle: "none", padding: 0 }}>
                {group.ids.map((id) => (
                  <li key={id} style={rowCardStyle}>
                    <span>{entryDisplayName(id, entryLabels)}</span>
                    <OpenDraftForReviewButton queueEntryId={id} />
                  </li>
                ))}
              </ul>
            </div>
          )
      )}
    </section>
  );
}

const rowCardStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "#fff",
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "10px 14px",
  marginBottom: 8
};

function SettingsScreen() {
  return (
    <section>
      <h2>Settings</h2>
      <p>Retention default: completed patient-level queue data is deleted once you confirm batch closure.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => window.rnDocRunner.clearSession()}>Clear Session</button>
        <button onClick={() => window.rnDocRunner.deleteImportedWorklist()}>Delete Imported Worklist</button>
      </div>
    </section>
  );
}
