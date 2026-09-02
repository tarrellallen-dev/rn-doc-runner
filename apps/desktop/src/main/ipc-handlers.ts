import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { ipcMain, type WebContents } from "electron";
import {
  parseWorklistCsv,
  extractWorklistRowsFromOcrLines,
  buildWorklistRows,
  sortByDaysOutstandingDescending,
  SwiftVisionOcrProvider,
  importWorklistFromPdf,
  createBatchControl,
  type QueueTarget,
  type BatchControl
} from "@rn-doc-runner/queue-engine";
import { resolveQueueTargets } from "./resolve-queue-targets.js";
import { startSyntheticBatch, openDraftForReview, type RunningBatchHandle } from "./batch-runner.js";
import { QueueStateStore } from "./queue-state-store.js";
import { CURRENT_AUTHOR, type BatchProgressSnapshot } from "../shared/ipc-contract.js";

export interface IpcHandlerDeps {
  ocrBinaryPath: string;
  syntheticEhrBaseUrl: string;
  queueStateStore: QueueStateStore;
  headless?: boolean;
}

let runningBatch: RunningBatchHandle | undefined;
/**
 * Set SYNCHRONOUSLY at the top of batch:start/batch:resumeFromCheckpoint,
 * before the (potentially slow, ~1s+) chromium.launch() call inside
 * startSyntheticBatch. Pause/Resume/Stop read this instead of
 * runningBatch?.control specifically so a request arriving during that
 * launch window has something to attach to immediately, rather than
 * being silently dropped because runningBatch itself isn't assigned
 * yet — a real race found during Phase 2 Mac validation (see
 * batch-runner.ts's RunSyntheticBatchOptions.control doc comment).
 */
let runningBatchControl: (BatchControl & { pause(): void; resume(): void; emergencyStop(): void }) | undefined;
let lastProgress: BatchProgressSnapshot = { completed: [], needsReview: [], skipped: [], blocked: [], running: false };
/** In-memory only: which patient/form/date each known queue entry ID refers to, so "Open Draft for Review" and the Completed Drafts/Exceptions screens can show a real label instead of a bare internal ID. Cleared on session clear. */
let lastTargets: QueueTarget[] = [];

function broadcastProgress(webContents: WebContents): void {
  if (!webContents.isDestroyed()) webContents.send("batch:progress", lastProgress);
}

export function registerIpcHandlers(deps: IpcHandlerDeps, getWebContents: () => WebContents | undefined): void {
  ipcMain.handle("worklist:importCsv", async (_event, csvText: string) => {
    const parsed = parseWorklistCsv(csvText);
    const rows = buildWorklistRows(
      parsed.rows.map((r) => ({
        patientNameRaw: r.patient,
        formDateRaw: r.date,
        formDateNormalized: r.date,
        daysOutstanding: r.daysOutstanding,
        formCategory: r.category,
        confidence: 1
      })),
      `import-csv-${Date.now()}`,
      "csv-upload"
    );
    return { rows: sortByDaysOutstandingDescending(rows), errors: parsed.errors };
  });

  ipcMain.handle("worklist:importImage", async (_event, imagePath: string) => {
    if (!fs.existsSync(deps.ocrBinaryPath)) {
      return { rows: [], skippedLineCount: 0, error: "ocr_helper_not_built" };
    }
    const provider = new SwiftVisionOcrProvider({ binaryPath: deps.ocrBinaryPath });
    const ocrResult = await provider.recognize(imagePath);
    if (!ocrResult.ok) return { rows: [], skippedLineCount: 0, error: ocrResult.error };
    const extraction = extractWorklistRowsFromOcrLines(ocrResult.lines);
    const rows = buildWorklistRows(extraction.rows, `import-image-${Date.now()}`, path.basename(imagePath));
    return { rows: sortByDaysOutstandingDescending(rows), skippedLineCount: extraction.skippedLineCount, orientationApplied: ocrResult.orientationApplied };
  });

  ipcMain.handle("worklist:importPdf", async (_event, pdfPath: string) => {
    if (!fs.existsSync(deps.ocrBinaryPath)) {
      return { ok: false, rows: [], pageCount: 0, skippedLineCount: 0, error: "ocr_helper_not_built" };
    }
    const provider = new SwiftVisionOcrProvider({ binaryPath: deps.ocrBinaryPath });
    const result = await importWorklistFromPdf(provider, pdfPath, `import-pdf-${Date.now()}`, path.basename(pdfPath));
    if (!result.ok) return result;
    return { ...result, rows: sortByDaysOutstandingDescending(result.rows) };
  });

  // Import Review preview panel (Phase 2 / Task P2-1): renders the exact
  // source page/photo a worklist row was extracted from, as an inline
  // data URL, so the RN can compare the OCR'd text against the original
  // without leaving the review screen. Never touches the network — the
  // rendered/converted bytes are read back locally and the temp file
  // (if any) is deleted immediately after.
  ipcMain.handle(
    "worklist:previewRow",
    async (_event, request: { sourcePath: string; sourceKind: "image" | "pdf"; pageNumber?: number }) => {
      if (!fs.existsSync(request.sourcePath)) return { ok: false, error: "source_file_not_found" };
      try {
        if (request.sourceKind === "pdf") {
          if (!fs.existsSync(deps.ocrBinaryPath)) return { ok: false, error: "ocr_helper_not_built" };
          const provider = new SwiftVisionOcrProvider({ binaryPath: deps.ocrBinaryPath });
          const tmpPath = path.join(os.tmpdir(), `rn-doc-runner-preview-${crypto.randomUUID()}.png`);
          try {
            const result = await provider.renderPdfPage(request.sourcePath, request.pageNumber ?? 1, tmpPath);
            if (!result.ok || !result.path) return { ok: false, error: result.error ?? "render_pdf_page_failed" };
            return { ok: true, dataUrl: `data:image/png;base64,${fs.readFileSync(result.path).toString("base64")}` };
          } finally {
            fs.rmSync(tmpPath, { force: true });
          }
        }

        const ext = path.extname(request.sourcePath).toLowerCase();
        if (ext === ".heic" || ext === ".heif") {
          if (!fs.existsSync(deps.ocrBinaryPath)) return { ok: false, error: "ocr_helper_not_built" };
          const provider = new SwiftVisionOcrProvider({ binaryPath: deps.ocrBinaryPath });
          const tmpPath = path.join(os.tmpdir(), `rn-doc-runner-preview-${crypto.randomUUID()}.png`);
          try {
            const result = await provider.convertImage(request.sourcePath, tmpPath);
            if (!result.ok || !result.path) return { ok: false, error: result.error ?? "convert_failed" };
            return { ok: true, dataUrl: `data:image/png;base64,${fs.readFileSync(result.path).toString("base64")}` };
          } finally {
            fs.rmSync(tmpPath, { force: true });
          }
        }

        const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
        return { ok: true, dataUrl: `data:${mime};base64,${fs.readFileSync(request.sourcePath).toString("base64")}` };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "preview_failed" };
      }
    }
  );

  ipcMain.handle("queue:confirm", async (_event, rows) => {
    return resolveQueueTargets(rows, CURRENT_AUTHOR);
  });

  ipcMain.handle("batch:start", async (event, targets: QueueTarget[]) => {
    if (runningBatch) return { ok: false, error: "batch_already_running" };
    // Created here, synchronously — before startSyntheticBatch's chromium.launch() — so a
    // Pause/Stop click during that launch window still lands on the control the batch will
    // actually use, instead of being silently dropped. See the module-level doc comment.
    const control = createBatchControl();
    runningBatchControl = control;
    lastProgress = { completed: [], needsReview: [], skipped: [], blocked: [], running: true };
    lastTargets = targets;
    const initialState = deps.queueStateStore.createInitial(`batch-${Date.now()}`, targets);

    runningBatch = await startSyntheticBatch({
      baseUrl: deps.syntheticEhrBaseUrl,
      targets,
      headless: deps.headless,
      control,
      onProgress: (progress) => {
        lastProgress = { ...lastProgress, ...progress, running: true };
        broadcastProgress(event.sender);
        // Persisted after every entry so an app crash mid-batch can resume from the last confirmed entry.
        deps.queueStateStore.save({ ...initialState, ...progress, updatedAt: new Date().toISOString() });
      }
    });

    runningBatch.resultPromise
      .then((finalResult) => {
        lastProgress = { ...finalResult, running: false };
        deps.queueStateStore.save({ ...initialState, ...finalResult, updatedAt: new Date().toISOString() });
        const wc = getWebContents();
        if (wc) broadcastProgress(wc);
      })
      .finally(() => {
        runningBatch = undefined;
        runningBatchControl = undefined;
      });

    return { ok: true };
  });

  ipcMain.handle("batch:pause", async () => {
    runningBatchControl?.pause();
  });
  ipcMain.handle("batch:unpause", async () => {
    runningBatchControl?.resume();
  });
  ipcMain.handle("batch:emergencyStop", async () => {
    runningBatchControl?.emergencyStop();
  });
  ipcMain.handle("batch:getProgress", async () => lastProgress);

  // Task 16: app-restart recovery. A persisted batch with unresolved
  // targets survives an app crash/quit (encrypted on disk); "Resume
  // Batch" continues it without ever reprocessing an entry that already
  // reached a terminal state.
  ipcMain.handle("batch:hasResumableState", async () => {
    const state = deps.queueStateStore.load();
    if (!state) return false;
    const terminal = new Set([...state.completed, ...state.needsReview, ...state.skipped, ...state.blocked]);
    return state.targets.some((t) => !terminal.has(t.queueEntryId));
  });

  ipcMain.handle("batch:resumeFromCheckpoint", async (event) => {
    const state = deps.queueStateStore.load();
    if (!state) return { ok: false, error: "no_persisted_batch" };
    if (runningBatch) return { ok: false, error: "batch_already_running" };

    const control = createBatchControl();
    runningBatchControl = control;
    lastProgress = { completed: state.completed, needsReview: state.needsReview, skipped: state.skipped, blocked: state.blocked, running: true };
    lastTargets = state.targets;

    runningBatch = await startSyntheticBatch({
      baseUrl: deps.syntheticEhrBaseUrl,
      targets: state.targets,
      headless: deps.headless,
      control,
      resumeFrom: { completed: state.completed, needsReview: state.needsReview, skipped: state.skipped, blocked: state.blocked, exceptions: state.exceptions },
      onProgress: (progress) => {
        lastProgress = { ...lastProgress, ...progress, running: true };
        broadcastProgress(event.sender);
        deps.queueStateStore.save({ ...state, ...progress, updatedAt: new Date().toISOString() } as typeof state);
      }
    });

    runningBatch.resultPromise
      .then((finalResult) => {
        lastProgress = { ...finalResult, running: false };
        deps.queueStateStore.save({ ...state, ...finalResult, updatedAt: new Date().toISOString() });
        const wc = getWebContents();
        if (wc) broadcastProgress(wc);
      })
      .finally(() => {
        runningBatch = undefined;
        runningBatchControl = undefined;
      });

    return { ok: true };
  });

  ipcMain.handle("session:clear", async () => {
    deps.queueStateStore.clear();
    lastProgress = { completed: [], needsReview: [], skipped: [], blocked: [], running: false };
    lastTargets = [];
  });
  ipcMain.handle("worklist:deleteImported", async () => {
    deps.queueStateStore.clear();
  });

  // Completed Drafts / Exceptions screens (Phase 2 / Task P2-7): a
  // human-readable patient/form/date label for every queue entry ID
  // this session knows about, so those screens never have to show a
  // bare internal ID.
  ipcMain.handle("batch:getEntryLabels", async () => {
    return lastTargets.map((t) => ({
      queueEntryId: t.queueEntryId,
      patient: t.criteria.patient,
      form: t.criteria.form,
      date: t.criteria.date
    }));
  });

  // "Open Draft for Review" (Phase 2 / Task P2-7): opens a real, visible
  // browser window on the exact document a completed/exception entry
  // refers to, so the RN can review or finish it herself. Read-only
  // navigation only — see batch-runner.ts's openDraftForReview.
  ipcMain.handle("batch:openDraftForReview", async (_event, queueEntryId: string) => {
    const target = lastTargets.find((t) => t.queueEntryId === queueEntryId);
    if (!target) return { ok: false, error: "queue_entry_not_found" };
    // The `browser` handle openDraftForReview returns exists only so a test can close
    // it after asserting (see batch-runner.ts) — it's a live Playwright object, not
    // something IPC's structured-clone can serialize, so it must never cross the bridge.
    const { ok, error } = await openDraftForReview(target, deps.syntheticEhrBaseUrl, deps.headless);
    return { ok, error };
  });
}
