/**
 * Encrypted-at-rest resumable state (Task 16). The actual OS-backed
 * encryption (Electron's `safeStorage`, itself backed by macOS Keychain)
 * is injected as a small `EncryptionBackend` interface so the file I/O
 * and JSON (de)serialization logic here can run — and be tested —
 * outside a live Electron process.
 */
import fs from "node:fs";
import path from "node:path";

export interface EncryptionBackend {
  isAvailable(): boolean;
  encrypt(plainText: string): Buffer;
  decrypt(buffer: Buffer): string;
}

export interface SecureStore {
  write(data: unknown): void;
  read<T>(): T | undefined;
  clear(): void;
  exists(): boolean;
}

export function createSecureStore(filePath: string, backend: EncryptionBackend): SecureStore {
  return {
    write(data: unknown) {
      if (!backend.isAvailable()) throw new Error("os_encryption_unavailable");
      const encrypted = backend.encrypt(JSON.stringify(data));
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, encrypted, { mode: 0o600 });
    },
    read<T>(): T | undefined {
      if (!fs.existsSync(filePath)) return undefined;
      const encrypted = fs.readFileSync(filePath);
      return JSON.parse(backend.decrypt(encrypted)) as T;
    },
    clear() {
      if (fs.existsSync(filePath)) fs.rmSync(filePath);
    },
    exists() {
      return fs.existsSync(filePath);
    }
  };
}

/** Deterministic, non-secret backend used only in tests — never in a shipped build. */
export function createInsecureTestBackend(): EncryptionBackend {
  return {
    isAvailable: () => true,
    encrypt: (plainText) => Buffer.from(plainText, "utf8"),
    decrypt: (buffer) => buffer.toString("utf8")
  };
}
