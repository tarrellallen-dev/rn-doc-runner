import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { RnDocRunnerApi } from "../shared/ipc-contract.js";

const api: RnDocRunnerApi = {
  importWorklistCsv: (csvText) => ipcRenderer.invoke("worklist:importCsv", csvText),
  importWorklistImage: (imagePath) => ipcRenderer.invoke("worklist:importImage", imagePath),
  importWorklistPdf: (pdfPath) => ipcRenderer.invoke("worklist:importPdf", pdfPath),
  previewRow: (request) => ipcRenderer.invoke("worklist:previewRow", request),
  confirmQueue: (rows) => ipcRenderer.invoke("queue:confirm", rows),
  startBatch: (targets) => ipcRenderer.invoke("batch:start", targets),
  pauseBatch: () => ipcRenderer.invoke("batch:pause"),
  unpauseBatch: () => ipcRenderer.invoke("batch:unpause"),
  emergencyStop: () => ipcRenderer.invoke("batch:emergencyStop"),
  getBatchProgress: () => ipcRenderer.invoke("batch:getProgress"),
  hasResumableState: () => ipcRenderer.invoke("batch:hasResumableState"),
  resumeFromCheckpoint: () => ipcRenderer.invoke("batch:resumeFromCheckpoint"),
  clearSession: () => ipcRenderer.invoke("session:clear"),
  deleteImportedWorklist: () => ipcRenderer.invoke("worklist:deleteImported"),
  onBatchProgress: (callback) => {
    const listener = (_event: unknown, snapshot: Parameters<typeof callback>[0]) => callback(snapshot);
    ipcRenderer.on("batch:progress", listener);
    return () => ipcRenderer.removeListener("batch:progress", listener);
  },
  getEntryLabels: () => ipcRenderer.invoke("batch:getEntryLabels"),
  openDraftForReview: (queueEntryId) => ipcRenderer.invoke("batch:openDraftForReview", queueEntryId)
};

contextBridge.exposeInMainWorld("rnDocRunner", api);
contextBridge.exposeInMainWorld("rnDocRunnerFiles", {
  getPathForFile: (file: File) => webUtils.getPathForFile(file)
});
