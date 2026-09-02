import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { createApp } from "@rn-doc-runner/synthetic-ehr";
import { runBatch, createBatchControl, type BatchRunnerDeps, type QueueTarget } from "@rn-doc-runner/queue-engine";
import {
  SNV_V1_ADAPTER,
  RECERT_V1_ADAPTER,
  RECERT_V1_RED_LINK_CONFIGS,
  STANDARD_IDENTITY_SELECTORS
} from "@rn-doc-runner/adapters-synthetic";
import type { DraftSaveConfig } from "@rn-doc-runner/form-engine";
import type { ResumeCheckpoint } from "@rn-doc-runner/contracts";

const EXPECTED_AUTHOR = "Nurse, Demo (RN)";

const PATIENT_IDS: Record<string, string> = {
  "Rehearsal Alpha": "pat-1",
  "Rehearsal Bravo": "pat-2",
  "Rehearsal Charlie": "pat-3",
  "Rehearsal Delta": "pat-4",
  "Rehearsal Foxtrot": "pat-6"
};

const SAVE_CONFIG: DraftSaveConfig = {
  saveButtonSelector: "#rn-save-draft",
  configuredSaveLabel: "Save Draft",
  successIndicatorSelector: "#rn-save-success",
  validationErrorIndicatorSelector: "#rn-save-validation-error",
  sessionExpiredIndicatorSelector: "#rn-session-expired",
  ambiguousIndicatorSelector: "#rn-save-ambiguous",
  waitTimeoutMs: 3000
};

let browser: Browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

function makeDeps(baseUrl: string): BatchRunnerDeps {
  return {
    baseUrl,
    identitySelectors: STANDARD_IDENTITY_SELECTORS,
    expectedAuthor: EXPECTED_AUTHOR,
    openNewPage: () => browser.newPage(),
    closePage: (page) => page.close(),
    formAdapterFor: (formType, formVersion) => {
      if (formType === "Skilled Nurse Visit Note" && formVersion === "SNV-v1") return SNV_V1_ADAPTER;
      if (formType === "OASIS/Nurse Recert" && formVersion === "RECERT-v1") return RECERT_V1_ADAPTER;
      return undefined;
    },
    formVersionFor: (formType) => {
      if (formType === "Skilled Nurse Visit Note") return "SNV-v1";
      if (formType === "OASIS/Nurse Recert") return "RECERT-v1";
      return undefined;
    },
    redLinkSectionsFor: (formType, _formVersion, pageIndex) =>
      formType === "OASIS/Nurse Recert" && pageIndex === 1 ? RECERT_V1_RED_LINK_CONFIGS : [],
    draftSaveConfigFor: () => SAVE_CONFIG,
    patientIdFor: (criteria) => PATIENT_IDS[criteria.patient]
  };
}

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

test("a mixed batch completes eligible documents, routes exceptions to review/blocked, and never stops on one failure", async () => {
  await withServer(async (base) => {
    const targets: QueueTarget[] = [
      { queueEntryId: "q-a2", criteria: { patient: "Rehearsal Alpha", mr: "SYN-1001", form: "Skilled Nurse Visit Note", date: "07/28/2026", user: EXPECTED_AUTHOR } },
      { queueEntryId: "q-b2", criteria: { patient: "Rehearsal Bravo", mr: "SYN-1002", form: "OASIS/Nurse Recert", date: "07/14/2026", user: EXPECTED_AUTHOR } },
      { queueEntryId: "q-c2", criteria: { patient: "Rehearsal Charlie", mr: "SYN-1003", form: "Skilled Nurse Visit Note", date: "07/20/2026", user: EXPECTED_AUTHOR } },
      { queueEntryId: "q-d2", criteria: { patient: "Rehearsal Delta", mr: "SYN-1004", form: "Skilled Nurse Visit Note", date: "07/22/2026", user: EXPECTED_AUTHOR } },
      { queueEntryId: "q-f1", criteria: { patient: "Rehearsal Foxtrot", mr: "SYN-1006", form: "Wound Care Note", date: "07/18/2026", user: EXPECTED_AUTHOR } }
    ];

    const result = await runBatch(targets, makeDeps(base));

    assert.deepEqual(result.completed.sort(), ["q-a2", "q-b2"]);
    assert.deepEqual(result.needsReview.sort(), ["q-c2", "q-d2"]);
    assert.deepEqual(result.blocked.sort(), ["q-f1"]);
    assert.equal(result.skipped.length, 0);

    const codes = result.exceptions.map((e) => e.code);
    assert.ok(codes.includes("PREDECESSOR_AMBIGUOUS"), codes.join(","));
    assert.ok(codes.includes("PREDECESSOR_NOT_FOUND"), codes.join(","));
    assert.ok(codes.includes("UNSUPPORTED_FORM"), codes.join(","));

    // Every exception must be nonclinical: no patient names, MR numbers, or dates leaked into the detail strings.
    for (const exc of result.exceptions) {
      assert.doesNotMatch(exc.nonclinicalDetail, /Rehearsal|SYN-\d{4}|\d{2}\/\d{2}\/\d{4}/);
    }

    const a2State = await (await fetch(`${base}/debug/state/doc-a2`)).json();
    assert.equal(a2State.saveCount, 2, "both SNV pages must have saved");
    const b2State = await (await fetch(`${base}/debug/state/doc-b2`)).json();
    assert.equal(b2State.saveCount, 2, "both Recert pages, including the red-link page, must have saved");
    assert.equal(b2State.redLinkSectionStatus.diagnoses, "complete");
    assert.equal(b2State.redLinkSectionStatus.orders, "complete");
  });
});

test("emergency stop halts the batch immediately and leaves later entries unprocessed", async () => {
  await withServer(async (base) => {
    const targets: QueueTarget[] = [
      { queueEntryId: "q-a2", criteria: { patient: "Rehearsal Alpha", mr: "SYN-1001", form: "Skilled Nurse Visit Note", date: "07/28/2026", user: EXPECTED_AUTHOR } },
      { queueEntryId: "q-b2", criteria: { patient: "Rehearsal Bravo", mr: "SYN-1002", form: "OASIS/Nurse Recert", date: "07/14/2026", user: EXPECTED_AUTHOR } }
    ];
    const control = createBatchControl();
    control.emergencyStop();

    const result = await runBatch(targets, makeDeps(base), control);
    assert.deepEqual(result.completed, []);
    assert.deepEqual(result.needsReview, []);
    assert.deepEqual(result.blocked, []);
  });
});

test("Task 16 resume: an entry that already reached a terminal state is never reprocessed on resume, but new entries still run", async () => {
  await withServer(async (base) => {
    const deps = makeDeps(base);
    const ambiguous: QueueTarget = {
      queueEntryId: "q-c2",
      criteria: { patient: "Rehearsal Charlie", mr: "SYN-1003", form: "Skilled Nurse Visit Note", date: "07/20/2026", user: EXPECTED_AUTHOR }
    };
    const fresh: QueueTarget = {
      queueEntryId: "q-a2",
      criteria: { patient: "Rehearsal Alpha", mr: "SYN-1001", form: "Skilled Nurse Visit Note", date: "07/28/2026", user: EXPECTED_AUTHOR }
    };

    const firstRun = await runBatch([ambiguous], deps);
    assert.deepEqual(firstRun.needsReview, ["q-c2"]);
    assert.equal(firstRun.exceptions.length, 1);

    // Simulate an app restart: a fresh runBatch call over BOTH the already-resolved
    // entry and a brand-new one, seeded with the prior run's result as resumeFrom.
    const resumed = await runBatch([ambiguous, fresh], deps, undefined, undefined, firstRun);

    assert.deepEqual(resumed.needsReview, ["q-c2"], "the ambiguous entry must not be replayed");
    assert.equal(resumed.exceptions.length, 1, "no new exception should be recorded for the already-resolved entry");
    assert.deepEqual(resumed.completed, ["q-a2"], "the new entry must still be processed normally");
  });
});

test("Task 16 resume: an entry interrupted mid-entry restarts at its first unconfirmed page and never re-clicks Save on a confirmed one", async () => {
  await withServer(async (base) => {
    // Every POST the batch makes to the EHR's save endpoint, counted at the
    // wire rather than inferred from the fixture's own duplicate detection —
    // the point of this test is the guard on our side of the click, not the
    // synthetic EHR's ability to notice a second one.
    const saveRequests: string[] = [];
    const instrument = (deps: BatchRunnerDeps): BatchRunnerDeps => ({
      ...deps,
      openNewPage: async () => {
        const page = await browser.newPage();
        page.on("request", (request) => {
          if (request.method() === "POST" && request.url().includes("/save")) saveRequests.push(request.url());
        });
        return page;
      }
    });

    const target: QueueTarget = {
      queueEntryId: "q-a2",
      criteria: { patient: "Rehearsal Alpha", mr: "SYN-1001", form: "Skilled Nurse Visit Note", date: "07/28/2026", user: EXPECTED_AUTHOR }
    };

    // --- Run 1: interrupted the moment page 0's save is checkpointed, before
    // the entry reaches any terminal state. This is the crash the entry-level
    // resume guard cannot see: q-a2 is in none of the result's lists.
    const control = createBatchControl();
    let captured: ResumeCheckpoint | undefined;
    const interrupted: BatchRunnerDeps = {
      ...instrument(makeDeps(base)),
      onCheckpoint: (checkpoint) => {
        captured = checkpoint;
        control.emergencyStop();
      }
    };
    await runBatch([target], interrupted, control);

    assert.ok(captured, "a checkpoint must be emitted as each save is confirmed, not only when an entry finishes");
    assert.deepEqual(
      captured!.confirmedSaveIdempotencyKeys,
      ["q-a2::page-0::SNV-v1"],
      "the checkpoint must carry every confirmed key, or a resume cannot rebuild the duplicate-save guard"
    );
    assert.equal(saveRequests.length, 1, "only page 0 was saved before the interruption");
    const afterInterruption = await (await fetch(`${base}/debug/state/doc-a2`)).json();
    assert.deepEqual(afterInterruption.savedPages, [0]);

    // --- Run 2: an app restart. Nothing is terminal, so the entry is
    // reprocessed — but the checkpoint says page 0 is already confirmed.
    saveRequests.length = 0;
    const resumed = await runBatch([target], instrument(makeDeps(base)), undefined, undefined, {
      completed: [],
      needsReview: [],
      skipped: [],
      blocked: [],
      exceptions: [],
      lastCheckpoint: captured
    });

    assert.deepEqual(resumed.completed, ["q-a2"], "the entry must finish, not stall on its already-saved page");
    assert.deepEqual(resumed.needsReview, []);
    assert.equal(saveRequests.length, 1, "Save must be clicked exactly once on resume — for page 1 only");
    assert.match(saveRequests[0]!, /page=1$/, "the one save on resume must be the page that was never confirmed");

    const finalState = await (await fetch(`${base}/debug/state/doc-a2`)).json();
    assert.equal(finalState.saveCount, 2, "each page saved exactly once across the interruption");
    assert.deepEqual(finalState.savedPages, [0, 1]);
  });
});

test("Task 16 resume: an entry whose page came back AMBIGUOUS is never replayed, even with a checkpoint in hand", async () => {
  await withServer(async (base) => {
    const target: QueueTarget = {
      queueEntryId: "q-a2",
      criteria: { patient: "Rehearsal Alpha", mr: "SYN-1001", form: "Skilled Nurse Visit Note", date: "07/28/2026", user: EXPECTED_AUTHOR }
    };
    // A crash immediately after an unconfirmable save: the entry never reached
    // NEEDS_REVIEW, so the entry-level guard would happily reprocess it.
    const checkpoint: ResumeCheckpoint = {
      batchId: "batch",
      queueEntryId: "q-a2",
      pageIndex: 0,
      state: "SAVE_PAGE",
      confirmedSaveIdempotencyKeys: [],
      unconfirmedSaveIdempotencyKeys: ["q-a2::page-0::SNV-v1"],
      checkpointedAt: new Date().toISOString()
    };

    const result = await runBatch([target], makeDeps(base), undefined, undefined, {
      completed: [],
      needsReview: [],
      skipped: [],
      blocked: [],
      exceptions: [],
      lastCheckpoint: checkpoint
    });

    assert.deepEqual(result.needsReview, ["q-a2"]);
    assert.deepEqual(result.exceptions.map((e) => e.code), ["SAVE_AMBIGUOUS"]);
    const state = await (await fetch(`${base}/debug/state/doc-a2`)).json();
    assert.equal(state.saveCount, 0, "an unconfirmed page is routed to a human without touching the record again");
  });
});
