import { app, BrowserWindow } from "electron";
import path from "node:path";
import { createSecureStore } from "./secure-store.js";
import { createElectronEncryptionBackend } from "./electron-encryption-backend.js";
import { QueueStateStore } from "./queue-state-store.js";
import { registerIpcHandlers } from "./ipc-handlers.js";
import { startNativeBridgeServer, DEFAULT_SOCKET_PATH } from "./native-bridge-server.js";

// esbuild always emits this file to apps/desktop/dist/main.cjs (CJS format), so __dirname is always defined.
const dir = __dirname;
const PROJECT_ROOT = path.resolve(dir, "../../..");

let mainWindow: BrowserWindow | undefined;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 800,
    title: "RN DOC Runner",
    webPreferences: {
      preload: path.join(dir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(dir, "renderer/index.html"));
}

app.whenReady().then(() => {
  const storeFile = path.join(app.getPath("userData"), "queue-state.enc");
  const secureStore = createSecureStore(storeFile, createElectronEncryptionBackend());
  const queueStateStore = new QueueStateStore(secureStore);

  registerIpcHandlers(
    {
      ocrBinaryPath: path.join(PROJECT_ROOT, "ocr-helper/.build/release/ocr-helper"),
      syntheticEhrBaseUrl: process.env.RN_DOC_RUNNER_SYNTHETIC_EHR_URL ?? "http://localhost:4173",
      queueStateStore,
      headless: process.env.RN_DOC_RUNNER_HEADLESS === "1"
    },
    () => mainWindow?.webContents
  );

  // Completes the M7 loop: the native-host process (launched by Chrome
  // when the extension calls connectNative) relays extension-side
  // messages here. Never fails hard if this can't bind — the desktop
  // app's own UI works standalone regardless.
  try {
    startNativeBridgeServer(DEFAULT_SOCKET_PATH, async (payload) => {
      const message = payload as { type?: string };
      if (message?.type === "PING") return { ok: true, type: "PONG" };
      return { ok: true, type: "ACK" };
    });
  } catch {
    // Non-fatal: desktop UI continues without the extension bridge.
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
