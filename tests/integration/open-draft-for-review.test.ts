/**
 * "Open Draft for Review" (Phase 2 / Task P2-7): the Completed Drafts /
 * Exceptions screens' action to open the exact live document a queue
 * entry refers to, in a real browser window, for the RN's own manual
 * review/signature. Read-only navigation only — this must never save,
 * sign, or submit anything, and must fail closed (never guess) when the
 * document can't be found unambiguously.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "@rn-doc-runner/synthetic-ehr";
import { openDraftForReview } from "@rn-doc-runner/desktop/main/batch-runner";
import type { QueueTarget } from "@rn-doc-runner/queue-engine";

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

test("openDraftForReview opens the exact matching pending document, read-only, without saving anything", async () => {
  await withServer(async (base) => {
    const target: QueueTarget = {
      queueEntryId: "q-a2",
      criteria: { patient: "Rehearsal Alpha", mr: "SYN-1001", form: "Skilled Nurse Visit Note", date: "07/28/2026", user: EXPECTED_AUTHOR }
    };
    const result = await openDraftForReview(target, base, true);
    assert.equal(result.ok, true, result.error);

    const state = await (await fetch(`${base}/debug/state/doc-a2`)).json();
    assert.equal(state.saveCount, 0, "opening a draft for review must never save anything");

    // Production deliberately never closes this browser (it's left open for the RN); a test must, or the process never exits.
    await result.browser?.close();
  });
});

test("openDraftForReview fails closed (never guesses) when no pending document matches the criteria", async () => {
  await withServer(async (base) => {
    const target: QueueTarget = {
      queueEntryId: "q-nonexistent",
      criteria: { patient: "Nobody Real", mr: "SYN-9999", form: "Skilled Nurse Visit Note", date: "01/01/2026", user: EXPECTED_AUTHOR }
    };
    const result = await openDraftForReview(target, base, true);
    assert.equal(result.ok, false);
    assert.equal(result.error, "pending_row_not_found");
  });
});
