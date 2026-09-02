/**
 * Regression test for a real bug found during Phase 2 Mac validation:
 * a Stop (or Pause) request issued while startSyntheticBatch's
 * chromium.launch() is still in flight had nothing to attach to (the
 * desktop app's ipc-handlers.ts only assigned its `runningBatch`
 * handle — and therefore its `.control` — *after* that launch
 * resolved), so the click was silently dropped and the batch ran to
 * completion as if Stop had never been clicked. Reproduced for real
 * against the actual packaged Electron app (clicking Stop within tens
 * of milliseconds of Start Batch let all 4 queued entries complete
 * anyway) before being traced to this exact race.
 *
 * The fix: startSyntheticBatch now accepts an optional pre-created
 * `control`, so the caller can create it *synchronously*, before ever
 * awaiting anything, and request emergencyStop() on it immediately —
 * closing the window entirely. This test proves that mechanism works:
 * a control stopped before startSyntheticBatch's browser has even
 * finished launching still results in zero entries processed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "@rn-doc-runner/synthetic-ehr";
import { startSyntheticBatch } from "@rn-doc-runner/desktop/main/batch-runner";
import { createBatchControl, type QueueTarget } from "@rn-doc-runner/queue-engine";

const EXPECTED_AUTHOR = "Nurse, Demo (RN)";

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fetch(`http://127.0.0.1:${port}/debug/reset`, { method: "POST" });
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const TARGETS: QueueTarget[] = [
  { queueEntryId: "q-a2", criteria: { patient: "Rehearsal Alpha", mr: "SYN-1001", form: "Skilled Nurse Visit Note", date: "07/28/2026", user: EXPECTED_AUTHOR } },
  { queueEntryId: "q-b2", criteria: { patient: "Rehearsal Bravo", mr: "SYN-1002", form: "OASIS/Nurse Recert", date: "07/14/2026", user: EXPECTED_AUTHOR } },
  { queueEntryId: "q-c2", criteria: { patient: "Rehearsal Charlie", mr: "SYN-1003", form: "Skilled Nurse Visit Note", date: "07/20/2026", user: EXPECTED_AUTHOR } }
];

test("a Stop requested on a pre-created control before the browser finishes launching is still honored (closes the race)", async () => {
  await withServer(async (base) => {
    const control = createBatchControl();
    // Simulate the RN clicking Stop essentially the instant after Start Batch —
    // stopped BEFORE startSyntheticBatch (and its chromium.launch()) is even called.
    control.emergencyStop();
    assert.equal(control.isStopped(), true);

    const handle = await startSyntheticBatch({ baseUrl: base, targets: TARGETS, headless: true, control });
    const result = await handle.resultPromise;

    assert.deepEqual(result.completed, []);
    assert.deepEqual(result.needsReview, []);
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.blocked, []);
  });
});

test("without a caller-supplied control, startSyntheticBatch still creates its own and runs normally (no regression to the default path)", async () => {
  await withServer(async (base) => {
    const handle = await startSyntheticBatch({ baseUrl: base, targets: [TARGETS[0]!], headless: true });
    const result = await handle.resultPromise;
    assert.deepEqual(result.completed, ["q-a2"]);
  });
});
