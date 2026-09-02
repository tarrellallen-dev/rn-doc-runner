# Known Limitations

Honest accounting of what this build does not do, as of the state
reflected in [BUILD_REPORT.md](BUILD_REPORT.md). Nothing here is
aspirational — it's what's actually missing or partial.

## Requires organizational deployment approval (not a code gap)

- **The real Devero adapter is disabled and unconfigured.** No live
  selector has been read, guessed, or reverse-engineered. Enabling it
  requires everything in [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)
  — a facility-approved training tenant, RN-approved field allowlists,
  security/IT review, and organizational sign-off. This is by design,
  not an oversight.
- **No live EHR page has ever been inspected.** All 137 automated tests
  run against the local synthetic EHR (`synthetic-ehr/`) only.
- **Adapter Calibration Mode has never been run against a real
  training tenant** — only its recorder logic has been exercised, on
  synthetic pages.

## Requires further engineering (real gaps)

- **Layout-drift detection is a tested primitive, not yet wired into
  the batch machine.** `detectLayoutFingerprint`/`verifyLayoutVersion`
  work and are tested (`tests/integration/form-engine.test.ts`), but
  `processQueueEntry` doesn't call them automatically before reading a
  page — drift today surfaces indirectly as a selector zero/multiple-match
  failure (still fail-closed, just a less specific exception code than
  a dedicated `LAYOUT_VERSION_MISMATCH`).
- **T25 (tab-close session clearing) has no automated test.** The
  handler exists (`extension/src/background.ts`'s `chrome.tabs.onRemoved`
  listener) and follows the same pattern as the original RN DOC OS
  extension it was ported from, but no Playwright test simulates a real
  tab closing against the loaded extension and asserts the session
  cleared.
- **T15 (unverified popup link) isn't applicable yet** — the synthetic
  EHR has no "unexpected popup" scenario, only the always-expected
  red-link modal.
- **The desktop app's "Start Batch" always runs Synthetic Development
  Mode** (a real, visible Chromium instance driven by Playwright against
  `localhost:4173`). There is no code path today for the desktop app to
  drive the *real* Chrome extension via the native-messaging bridge for
  an actual batch run — the native-host↔desktop-app socket bridge exists
  and is tested (M7/M8), but nothing yet sends a "run this batch" command
  over it. Production automation would need this wiring, gated by
  Production Draft Mode being unlocked in the first place.
- **No macOS code-signing/notarization has been performed.** The
  Electron app runs as an unsigned local build; distributing it (even
  internally) would need Apple Developer signing, which requires
  credentials this build process doesn't have and shouldn't have.
- **One outstanding `npm audit` high-severity advisory: Electron
  `<=39.8.4`.** A fix exists (`npm audit fix --force`) but is a
  breaking major upgrade (`33` → `43`) that hasn't been applied or
  tested against this app's Electron API surface — that decision and
  the follow-up testing belong to the project owner. See
  `docs/BUILD_REPORT.md`'s "Mac Validation Pass" section.

## Explicitly out of scope by design (not limitations)

- Signing, submitting, finalizing, sending to office, or locking a
  document — no code path exists anywhere in this repository capable of
  this, by design, not by incomplete implementation.
- Cloud OCR, any AI/LLM call in the live-record path, analytics, or
  telemetry of any kind.
- Automating EHR login/credentials.

## If you're evaluating this for a next phase

Read [BUILD_REPORT.md](BUILD_REPORT.md) for the milestone-by-milestone
status and [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) for
exactly what organizational steps come before any live use, regardless
of code readiness.
