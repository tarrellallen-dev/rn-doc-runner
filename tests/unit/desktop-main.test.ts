import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSecureStore, createInsecureTestBackend } from "@rn-doc-runner/desktop/main/secure-store";
import { QueueStateStore } from "@rn-doc-runner/desktop/main/queue-state-store";
import { resolveQueueTargets } from "@rn-doc-runner/desktop/main/resolve-queue-targets";
import { buildWorklistRows } from "@rn-doc-runner/queue-engine";
import { DEFAULT_RETENTION_CONFIG } from "@rn-doc-runner/contracts";

function tmpFile(): string {
  return path.join(os.tmpdir(), `rn-doc-runner-store-${Date.now()}-${Math.random().toString(36).slice(2)}.enc`);
}

test("secure store round-trips arbitrary JSON through the injected encryption backend", () => {
  const filePath = tmpFile();
  const store = createSecureStore(filePath, createInsecureTestBackend());
  assert.equal(store.exists(), false);
  store.write({ hello: "world", count: 3 });
  assert.equal(store.exists(), true);
  assert.deepEqual(store.read(), { hello: "world", count: 3 });
  store.clear();
  assert.equal(store.exists(), false);
  assert.equal(store.read(), undefined);
  fs.rmSync(filePath, { force: true });
});

test("secure store refuses to write when the encryption backend reports itself unavailable", () => {
  const filePath = tmpFile();
  const store = createSecureStore(filePath, { isAvailable: () => false, encrypt: () => Buffer.from(""), decrypt: () => "" });
  assert.throws(() => store.write({ x: 1 }), /os_encryption_unavailable/);
  fs.rmSync(filePath, { force: true });
});

test("the persisted file is actually opaque ciphertext, not readable JSON, under a real-shaped backend", () => {
  const filePath = tmpFile();
  // A backend that actually obscures content (base64 is not real encryption, but proves the store
  // never writes raw JSON to disk itself -- that responsibility belongs entirely to the backend).
  const store = createSecureStore(filePath, {
    isAvailable: () => true,
    encrypt: (s) => Buffer.from(Buffer.from(s, "utf8").toString("base64")),
    decrypt: (b) => Buffer.from(b.toString("utf8"), "base64").toString("utf8")
  });
  store.write({ patientCount: 5 });
  const raw = fs.readFileSync(filePath, "utf8");
  assert.doesNotMatch(raw, /patientCount/);
  assert.deepEqual(store.read(), { patientCount: 5 });
  fs.rmSync(filePath, { force: true });
});

test("QueueStateStore.applyRetentionOnBatchClose deletes state when retention says to, and keeps it when configured not to", () => {
  const deletingStore = new QueueStateStore(createSecureStore(tmpFile(), createInsecureTestBackend()));
  deletingStore.createInitial("batch-1", []);
  assert.equal(deletingStore.exists(), true);
  deletingStore.applyRetentionOnBatchClose();
  assert.equal(deletingStore.exists(), false);

  const keepingStore = new QueueStateStore(createSecureStore(tmpFile(), createInsecureTestBackend()));
  keepingStore.createInitial("batch-2", [], { ...DEFAULT_RETENTION_CONFIG, deleteCompletedOnBatchClose: false });
  keepingStore.applyRetentionOnBatchClose();
  assert.equal(keepingStore.exists(), true);
});

test("resolveQueueTargets looks up MR from the synthetic patient directory and rejects duplicates/unidentified rows", () => {
  const rows = buildWorklistRows(
    [
      { patientNameRaw: "Rehearsal Alpha", formDateRaw: "07/28/2026", formDateNormalized: "7/28/2026", formCategory: "Skilled Nurse Visit Note", confidence: 0.9 },
      { patientNameRaw: "Rehearsal Alpha", formDateRaw: "07/28/2026", formDateNormalized: "7/28/2026", formCategory: "Skilled Nurse Visit Note", confidence: 0.5 },
      { patientNameRaw: "Nobody Real", formDateRaw: "07/28/2026", formDateNormalized: "7/28/2026", formCategory: "Skilled Nurse Visit Note", confidence: 0.9 },
      { patientNameRaw: "Rehearsal Bravo", formDateRaw: "not a date", formDateNormalized: null, formCategory: "OASIS/Nurse Recert", confidence: 0.9 }
    ],
    "import-1",
    "file-1"
  );
  const result = resolveQueueTargets(rows, "Nurse, Demo (RN)");
  assert.equal(result.targets.length, 1);
  assert.deepEqual(result.targets[0]?.criteria, {
    patient: "Rehearsal Alpha",
    mr: "SYN-1001",
    form: "Skilled Nurse Visit Note",
    date: "7/28/2026",
    user: "Nurse, Demo (RN)"
  });
  const reasons = result.unresolved.map((u) => u.reason).sort();
  assert.deepEqual(reasons, ["duplicate_of_another_row", "patient_not_found_in_directory", "unnormalizable_date"]);
});

test("resolveQueueTargets silently drops rows the RN removed on the Import Review screen, without reporting them as unresolved", () => {
  const rows = buildWorklistRows(
    [
      { patientNameRaw: "Rehearsal Alpha", formDateRaw: "07/28/2026", formDateNormalized: "7/28/2026", formCategory: "Skilled Nurse Visit Note", confidence: 0.9 },
      { patientNameRaw: "Nobody Real", formDateRaw: "07/28/2026", formDateNormalized: "7/28/2026", formCategory: "Skilled Nurse Visit Note", confidence: 0.2 }
    ],
    "import-2",
    "file-2"
  );
  const withRemoval = rows.map((r) => (r.patientNameRaw === "Nobody Real" ? { ...r, removed: true } : r));
  const result = resolveQueueTargets(withRemoval, "Nurse, Demo (RN)");
  assert.equal(result.targets.length, 1);
  assert.equal(result.unresolved.length, 0);
});
