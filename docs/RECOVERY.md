# Recovery, Retention, and Emergency Stop

## Encrypted resumable state

`apps/desktop/src/main/queue-state-store.ts` persists batch progress
(targets, completed/needsReview/skipped/blocked lists, exceptions, and
the last confirmed-save checkpoint) after **every** queue entry, not
just at batch end, encrypted via `secure-store.ts`. The real backend is
Electron's `safeStorage` (macOS Keychain-backed); see
`apps/desktop/src/main/electron-encryption-backend.ts`.

## App restart recovery ("Resume Batch")

If the app is closed or crashes mid-batch, reopening it and clicking
**Resume Batch** (Home screen, shown only when resumable state exists —
`hasResumableState` IPC handler) calls
`packages/queue-engine`'s `runBatch(..., resumeFrom: priorResult)`.

The mechanism: `runBatch` builds a set of every queue entry ID that
already reached a **terminal** state (`completed`, `needsReview`,
`skipped`, or `blocked`) in the prior result, and skips them outright —
they are never reprocessed, never re-saved, never re-evaluated. This is
what makes "last confirmed save resume" and "never replay an ambiguous
page" actual guarantees rather than aspirations:
`tests/integration/batch-machine.test.ts`'s resume test asserts the
exception count for an already-`needsReview` entry doesn't grow across
a simulated restart, while a genuinely new entry in the same resumed run
still processes normally.

## Session-expired pause

`packages/form-engine/src/draft-save.ts` reports `outcome: "SESSION_EXPIRED"`
when the configured session-expired indicator appears after a save
attempt. The batch machine (`processQueueEntry`) records a
`SESSION_EXPIRED` exception and returns `BLOCKED` with the checkpoint
preserved — it never attempts to log back in itself. You log back into
the EHR yourself; resuming the batch afterward picks up from the
checkpoint.

## Extension disconnect / native host absence

The native messaging host (`native-host/`) is a dumb relay with no state
of its own. If Chrome hasn't launched it (extension not installed, or no
manifest registered), `chrome.runtime.connectNative` in
`extension/src/background.ts` fails inside a `try/catch` — the extension
continues working standalone (manual popup capture/compare/apply). If
the desktop app isn't running when the native host *is* launched,
`native-host/src/desktop-bridge.ts` reports `desktop_app_unavailable`
rather than hanging or silently no-opping.

## Layout-drift / adapter-version mismatch

`packages/form-engine`'s `detectLayoutFingerprint` (backed by
`dom-reader.ts`'s `detectActiveSelectorSet`) checks which of the
adapter's known selector sets is actually live on the page, and
`packages/rules`'s `verifyLayoutVersion` fails closed the moment the
observed fingerprint doesn't match the adapter's recorded one —
exercised against a deliberately drifted synthetic page in
`tests/integration/form-engine.test.ts`. This primitive exists and is
tested; the batch machine does not yet call it automatically on every
page (see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)) — today, drift
shows up as selector zero/multiple-match failures in the normal
identity/control read path, which is also fail-closed, just with a less
specific exception code.

## Temporary-state clearing

- Extension: `SESSION_CLEAR` (popup "Clear session" button) and
  `EMERGENCY_STOP` both clear `chrome.storage.session`; a linked tab
  closing also clears it (`chrome.tabs.onRemoved`).
- Desktop: `session:clear` IPC clears the encrypted queue-state file.

## Completed-batch cleanup / retention

`QueueStateStore.applyRetentionOnBatchClose()` deletes persisted state
once retention says to. Default (`DEFAULT_RETENTION_CONFIG`,
`packages/contracts/src/retention.ts`): delete completed patient-level
queue data on batch close (`deleteCompletedOnBatchClose: true`, 0-day
retention). Configurable via the `RetentionConfig` contract; the desktop
Settings screen exposes Clear Session / Delete Imported Worklist
manually regardless of the automatic policy.

## Emergency Stop

`packages/queue-engine`'s `createBatchControl().emergencyStop()` sets a
flag `runBatch` checks between every entry (and the pause-wait loop
checks continuously) — no further page is opened, no further save is
attempted. The extension's popup and the desktop's Running Batch screen
both expose it (labeled **Stop** in the desktop UI — see
`docs/USER_GUIDE.md` — but wired to the same `emergencyStop()` call).
`tests/integration/batch-machine.test.ts` verifies a pre-stopped
control processes zero entries.

## What's never logged

Nothing in the recovery/exception path carries a patient name, MR
number, or date — see [SECURITY_MODEL.md](SECURITY_MODEL.md)'s
"Nonclinical logging" section.
