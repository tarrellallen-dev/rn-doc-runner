/** Only file in the app that touches Electron's safeStorage directly — everything else depends on the generic EncryptionBackend interface. */
import { safeStorage } from "electron";
import type { EncryptionBackend } from "./secure-store.js";

export function createElectronEncryptionBackend(): EncryptionBackend {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plainText) => safeStorage.encryptString(plainText),
    decrypt: (buffer) => safeStorage.decryptString(buffer)
  };
}
