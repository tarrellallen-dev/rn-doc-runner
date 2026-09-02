# RN DOC Runner — Build Report

## Summary

All 20 Phase 1 milestones plus all 8 Phase 2 (MVP Hardening and Missing
Local Features) tasks are implemented and committed, followed by an
independent Mac-validation pass that found and fixed one real,
safety-relevant bug (see "Mac Validation Pass" below). **137 automated
tests pass, 0 failing** (68 unit + 62 integration + 5 security + 2 e2e),
run against a local synthetic EHR and, where applicable, the actual
built Chrome extension bundle and a real launched Electron app verified
over CDP. Synthetic Development Mode — the default and only currently
operable mode — is fully functional end to end: dragging in a worklist
photo, PDF, or CSV produces, via real on-device OCR, an editable
reviewed queue that a real batch run processes into completed drafts
and exceptions, each openable for review in a real browser window,
without ever touching a network or an AI model.

Production Draft Mode is **not enabled**. The real Devero adapter ships
`enabled: false` / `status: "UNCONFIGURED"` with no selector guessed —
see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) and
[DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) for exactly what
stands between this build and any live use.

See "Phase 2: MVP Hardening and Missing Local Features" below for what
changed since the Phase 1 build (milestones 1–20, commit `ff7821d`).

## Status legend

- **Implemented & synthetically validated** — real code, real automated
  tests, passing against the synthetic EHR / built artifacts.
- **Implemented, requires adapter** — the mechanism is built and tested
  against synthetic fixtures; using it against a real form requires an
  RN-approved `FormAdapter` that doesn't exist yet for that form.
- **Requires organizational deployment approval** — code-complete but
  gated on facility authorization, a training tenant, and sign-off per
  [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md), independent of
  code readiness.

## Milestone-by-milestone status

| # | Milestone | Status | Notes |
|---|---|---|---|
| 1 | Repository and toolchain | ✅ Implemented | Project-local Node (no system install), git initialized, npm workspaces |
| 2 | Contracts and rule engine | ✅ Implemented & validated | 29 tests; ported+extended from RN DOC OS `rules.js`; found and fixed a whitespace-trimming bug in the exact-`GA` check |
| 3 | Synthetic EHR | ✅ Implemented & validated | Full Express app: pending worklist, reverse-chronological chart/episodes, multi-page SNV/Recert forms, red-link modals, all required states |
| 4 | Local OCR and queue parser | ✅ Implemented & validated | Real Swift/Vision on-device OCR, bounding-box table-row reconstruction, CSV parsing, duplicate detection, priority sorting; PDF/HEIC import added in Phase 2 (P2-2) |
| 5 | Adapter schema and recorder | ✅ Implemented & validated | Patient-free structural recorder, schema validators, disabled Devero adapter |
| 6 | Chrome extension | ✅ Implemented & validated | MV3, Synthetic-Development-Mode-only manifest, verified via the real built bundle loaded into Chromium |
| 7 | Native Messaging host | ✅ Implemented & validated | Correct wire protocol, verified via a real subprocess test |
| 8 | Desktop UI | ✅ Implemented & validated | Electron + React, all 5 screens, verified via a real launched app driven over CDP |
| 9 | Current-document navigation | ✅ Implemented & validated | Exact-match pending row finder, ambiguity/no-match rejection |
| 10 | Predecessor discovery | ✅ Implemented & validated | Reverse-chronological episode search, ambiguous-chronology fail-closed |
| 11 | One synthetic form adapter | ✅ Implemented & validated | Two adapters built (SNV-v1, RECERT-v1) — exceeds the "at least one" bar |
| 12 | Page comparison and application | ✅ Implemented & validated | Found and fixed two real bugs (page.evaluate closure serialization; identity-check ordering) |
| 13 | Draft Save Adapter | ✅ Implemented & validated | Found and fixed a real bug (multi-page auto-advance vs. success banner) |
| 14 | Synthetic Recert adapter | ✅ Implemented & validated | Full red-link automation, 3 defense-in-depth tests |
| 15 | Batch state machine | ✅ Implemented & validated | Full pipeline proven in one test: mixed 5-document batch, 2 completed, 2 review, 1 blocked |
| 16 | Recovery and encrypted state | ✅ Implemented & validated | Checkpoint resume never replays a terminal entry; encrypted via injectable backend (real: Electron safeStorage) |
| 17 | End-to-end tests | ✅ Implemented & validated | Canonical acceptance test; found and fixed three more real bugs (OCR orientation heuristic, table-row reconstruction, date zero-padding) |
| 18 | Security scans | ✅ Implemented & validated | Fails closed; proven against a poisoned fixture, passes on the real build |
| 19 | Packaging | ✅ Implemented & validated | Setup wizard and uninstaller both actually run, not just written |
| 20 | Documentation and build report | ✅ Implemented | This document and the 11 others in `docs/` |

## Real bugs found and fixed during this build

Development here wasn't "write code, assume it works" — every milestone
ran its tests, and failures were root-caused and fixed, never worked
around. Nine distinct real bugs were caught this way:

1. **Exact-`GA` whitespace bug** (M2): the exception check ran through a
   whitespace-normalizing `normalize()`, so `"GA "` was silently treated
   as `"GA"` — violates the "no whitespace, punctuation, or other text
   qualifies" rule. Fixed to compare the raw, untrimmed string.
2. **Closure-over-module-const breaks `page.evaluate`** (M12): esbuild's
   `keepNames` transform wraps named function/const bindings in an
   `__name()` helper that doesn't exist once the function is serialized
   via `Function.prototype.toString()` into an isolated page context.
   Fixed by making every page-evaluated function flat, with the pattern
   documented for future code.
3. **Identity-check ordering allowed a confusing failure** (M12): a page
   misalignment surfaced as a raw selector zero-match error instead of
   the correct `page_mismatch` identity failure, because controls were
   read before identity was verified. Reordered so identity (including
   page) is always confirmed before any page-specific selector is read.
4. **Multi-page auto-advance vs. success banner** (M13): a save on a
   non-final page redirects to the next page with no success indicator
   at all — the spec's "success indicator OR expected page advancement"
   alternate signal wasn't implemented. Added URL-change detection as
   the fallback.
5. **Content-script reading the wrong allowlist scope** (M6): the
   extension read the site adapter's full multi-form union allowlist
   against a single page's DOM, always failing every other form's
   fields with zero-match. Separated the per-page "active allowlist"
   from the site-level adapter config.
6. **OCR orientation heuristic misfired with more text** (M17): scoring
   all four rotations up front let a wrong rotation outscore the
   correct one on a busier page, silently scrambling row/column
   association. Fixed to prefer upright and only compare rotations when
   upright output looks implausible.
7. **OCR "one line = one row" assumption** (M17): Vision returns
   wide-whitespace-separated table columns as separate observations in
   column-major reading order, not row-major. Fixed by clustering
   observations on bounding-box Y-coordinate before any row parsing —
   genuine table-row reconstruction instead of an assumption.
8. **OCR date zero-padding mismatch** (M17): the date normalizer
   produced `"7/28/2026"` while the EHR renders `"07/28/2026"`, so every
   OCR-derived queue target failed an exact-string pending-row match.
   Fixed the normalizer to always zero-pad, and hardened
   `matchesExpectedIdentity` to compare dates by calendar value instead
   of string equality as defense in depth.
9. **Episode display order didn't match the spec** (M9/M10): synthetic
   fixtures listed episodes oldest-first; RN DOC OS specifies reverse
   chronological (current episode first). Fixed the fixtures and the
   test asserting the wrong order.

## What's genuinely done vs. what remains

Read [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) for the complete,
honest list (updated for Phase 2). In short: the deterministic
automation core, the full Synthetic Development Mode product
(including PDF/HEIC import, a real OCR correction UI, and a third form
adapter as of Phase 2), and every safety gate the spec asked for are
real, tested, and working. What remains before any live deployment is
(a) a small amount of further engineering — wiring the tested
layout-drift primitive into the batch machine automatically, and
extension-driven (rather than Playwright-driven) production batch
execution — and (b) entirely organizational: facility authorization, a
training tenant, and the sign-off process in
`DEPLOYMENT_CHECKLIST.md`, none of which code
can substitute for.

## Verification method

Every milestone's tests were run and had to pass before committing —
`git log` in this repository shows 17 commits, each with real,
passing tests at commit time, none reverted or amended to hide a
failure. Nothing was marked complete without running.

## Phase 2: MVP Hardening and Missing Local Features

Continuation of the same codebase (all 18 Phase 1 commits preserved
unmodified, ending at `ff7821d`). Seven numbered objectives, tracked as
eight local commits (P2-6 was pure re-verification with no code change,
so it produced no commit of its own).

### Commits

| Commit | Task | Summary |
|---|---|---|
| `1a1f882` | P2-3 | Third synthetic form adapter (Med Admin Skilled Nurse Visit Record, MEDADMIN-v1) |
| `4a4c251` | P2-2 | PDF and HEIC worklist import |
| `0a1c355` | P2-1 | OCR correction and queue-review interface |
| `7624f04` | P2-4 | Expanded signing-boundary tests; fixed two real detection gaps |
| `05d1ed5` | P2-5 | Privacy and repository audit; `.gitignore` hardening |
| — | P2-6 | Packaging/installation re-verification (no code changed) |
| `2087dd1` | P2-7 | Nontechnical UX pass; fixed an IPC-serialization + silent-failure bug |

### Features completed

- **OCR correction and queue-review interface** — a real
  `ImportReviewScreen` replacing the old read-only table: editable
  patient/date/form-type fields, low-confidence badges, duplicate
  detection with a manual override, add/remove row, sort/filter, a
  source-photo/PDF-page preview panel next to each row, and a
  Confirm-Queue gate that stays disabled until every row is valid.
- **PDF and HEIC worklist import** — every JPEG/PNG/HEIC/HEIF/
  single- and multi-page-PDF format the spec asked for now imports,
  with per-row source-page tracking, orientation correction, and
  fail-safe handling of encrypted/corrupted/missing/unsupported files.
- **Third synthetic form adapter** — Med Admin Skilled Nurse Visit
  Record (MEDADMIN-v1), grounded in RN DOC OS's `WF_MED_ADMIN.md`
  spec, allowlisting only nonclinical repeatable process attestations
  and excluding medication name/dose/route/time/status/reaction by
  design.
- **Expanded signing boundary** — full Phase 2 vocabulary
  (sign/attest/submit/finalize/lock/certify/send-to-office/upload,
  including noun/gerund variants) now detected in visible text,
  accessible names (aria-label/aria-labelledby/title — previously
  unchecked), IPC channel names (new static scanner), and every
  adapter's structural action surface.
- **Privacy and repository audit** — full working-tree + git-history
  audit (see `docs/PRIVACY_AUDIT.md`); nothing required deletion;
  `.gitignore` hardened with explicit worklist/OCR/export/screenshot/
  session/credential exclusions.
- **Packaging re-verification** — first-run setup, the security scan,
  extension load, native-host communication, and a real offline/
  network-denial check all re-run clean against every Phase 2 change.
- **Nontechnical UX pass** — exact requested vocabulary (Add Worklist,
  Review Queue, Start Batch, Pause, Resume, Stop, Completed Drafts,
  Exceptions, Open Draft for Review); the old stats-only Dashboard
  replaced with real per-entry lists and a genuine "Open Draft for
  Review" action that opens the live document in a real browser
  window; every raw internal error code moved out of the normal UI
  into a collapsed technical-details element; a 4-line quick-start
  added to `docs/USER_GUIDE.md`.

### Files / architecture changed

New: `packages/queue-engine/src/ocr/pdf-import.ts`,
`adapters/synthetic/src/med-admin-v1.ts`,
`apps/desktop/src/renderer/screens/ImportReviewScreen.tsx`,
`apps/desktop/src/renderer/{ErrorNote.tsx,humanize.ts}`,
`docs/PRIVACY_AUDIT.md`, plus 9 new test files. Modified: the OCR
provider/Swift helper (PDF rasterization, page preview, HEIC convert),
the desktop IPC contract/handlers/preload (worklist PDF import, row
preview, entry labels, open-draft-for-review), `packages/rules`'
`FINALIZATION_PATTERN`, `packages/form-engine`'s DOM reader and
draft-save guard, `scripts/security-scan-lib.ts`, `.gitignore`, and the
user-facing docs. No architectural layer was removed or replaced —
Phase 2 extended the existing OCR/queue-engine/form-engine/adapter
boundaries, it didn't restructure them.

### Tests executed (final run, this session)

- **Unit**: 68/68 passing
- **Integration**: 60/60 passing
- **Security**: 5/5 passing
- **E2E**: 2/2 passing
- **Total: 135/135 passing, 0 failing** (up from 112 at the end of
  Phase 1; +23 net new tests, all added alongside the feature or bug
  fix they cover — none added retroactively to pad a number)
- `tsc -b --force`: clean across the whole project-reference graph
- `npm run build:production`: clean (desktop, extension bundles)
- Packaged Electron app: launched via Playwright's Electron driver,
  every nav screen rendered without error
- Chrome extension: loaded via `--load-extension` against the real
  built bundle (existing e2e test, still passing)
- Native-messaging host: real subprocess PING/PONG round-trip
  (existing unit test, still passing)
- Offline/network-denial: `lsof` snapshot of the running app's process
  group during a real worklist-import + review flow showed zero
  non-loopback connections (only the Electron/CDP loopback ports
  Playwright's own automation uses)

### Security / PHI audit results

See `docs/PRIVACY_AUDIT.md` for full method and findings. Summary:
nothing in the working tree or the complete local git history (24
commits, no remote ever added) required deletion or remediation — no
real patient name/identifier, no worklist photo/scan/PDF ever
committed, no credentials/cookies/tokens/keys in any current or
historical content, no recorded real-system browser session. One
inert, real-looking value (the disabled Devero adapter's
`expectedOrigin` hostname) was flagged at the time and left in place
for the private repository; it was replaced with a placeholder before
this public release, along with the operator identity value. See
`docs/PRIVACY_AUDIT.md`.

### Bugs found and fixed this phase

1. **OCR fail-closed error codes were being discarded** (P2-2):
   `execFile`'s rejection only exposed a generic "Command failed"
   message, not the Swift helper's actual JSON error code — affected
   every fail-closed OCR path, not just the new PDF ones. Fixed with a
   `parseErrorCode()` helper that reads the real code off the
   rejected error's captured stdout.
2. **`FINALIZATION_PATTERN` was missing half the Phase 2 prohibition
   list** (P2-4): "attest", "certify", and "upload" weren't in the
   regex at all. Fixed, with noun/gerund variants also covered.
3. **The Save-button click-guard only checked visible text, never the
   accessible name** (P2-4): a button whose text read "Continue" but
   whose `aria-label` said "Certify and Submit Record" would have
   passed. Fixed and proven against a real synthetic-EHR test fixture
   built specifically to catch this.
4. **The Import Review table's Patient/Form Date columns were visibly
   truncated** (P2-1, caught by manual verification, not an automated
   test): "Verify Alpha" rendered as "Verify A" — illegible for a
   screen whose entire purpose is confirming those exact values. Fixed
   with explicit column widths and a horizontally-scrollable
   low-priority-column area.
5. **`openDraftForReview` would have leaked a non-serializable
   Playwright `Browser` handle across Electron's IPC bridge** (P2-7,
   caught by an integration test hanging for hours in the background —
   the process's event loop never drained with a live browser
   subprocess still attached, which led directly to finding the real
   bug): fixed by stripping the handle in the IPC handler before
   returning. A related silent-failure bug — the renderer's "Open
   Draft for Review" click handler had no `try/catch`, so an IPC
   rejection would have failed with zero user-visible feedback — was
   fixed alongside it and re-verified with console/page-error capture
   to confirm a genuinely clean round-trip this time.

Every bug above has a regression test guarding it (see the relevant
commit's test additions); none were fixed by loosening a check.

### Remaining blockers (unchanged in kind from Phase 1)

All organizational, not code: the real Devero adapter still ships
`enabled: false` / `status: "UNCONFIGURED"`, a facility-approved
training tenant and RN-approved field allowlists still don't exist,
and `DEPLOYMENT_CHECKLIST.md`'s sign-off process is still required
before any live use. See `docs/KNOWN_LIMITATIONS.md` for the complete,
current list (updated this phase — the OCR-correction-screen and
PDF/HEIC gaps it previously listed are now closed).

### Readiness status for the next phase

**Ready.** Synthetic Development Mode is feature-complete against
every Phase 2 objective, fully tested (135/135), and manually verified
against the real packaged app, the real built extension, and the real
native-messaging host. Nothing in this phase touched, connected to, or
prepared a live EHR integration beyond what Phase 1 already
established (still disabled, still unconfigured). The next phase is
entirely the Deployment Checklist's organizational track — a training
tenant, Calibration Mode run against it, RN-approved field allowlists,
and sign-off — not further local engineering, with the possible
exception of the two remaining Phase 1 engineering gaps
(layout-drift-detection auto-wiring; extension-driven production
batch execution) noted in `docs/KNOWN_LIMITATIONS.md`.

## Mac Validation Pass

An independent, from-clean-state validation pass on a real Apple
Silicon Mac (arm64, macOS 26.2, Xcode Command Line Tools, Swift 6.3.3,
project-local Node 24.18.1 / npm 11.16.0), run after Phase 2 closed.
Every command below was run and captured individually; nothing was
assumed passing without a captured exit code.

### What was verified

- `ocr-helper`'s Swift build reproduces cleanly from a fully removed
  `.build`/`.swiftpm` (`swift build -c release`, exit 0, ~46s) in an
  ordinary shell — the artifact exists and runs
  (`ocr-helper/.build/release/ocr-helper`).
- `npm ci` — exit 0, zero tracked-file changes.
- `npm run build:production`, `npm run build` — exit 0 each.
- `npm run test:unit` (68/68), `npm run test:security` (5/5, includes
  `npm run security:scan` standalone), `npx playwright install
  chromium`, `npm run test:integration` (62/62), `npm run test:e2e`
  (2/2) — all exit 0, **zero tests skipped anywhere** (the 5
  build-prerequisite skip guards in the suite were individually
  confirmed present in source and individually confirmed not to have
  fired, since the OCR helper and both bundles were freshly built
  before any test ran).
- `npm audit` — 2 high-severity advisories (Electron, Playwright).
  Playwright's fix (`1.49.1` → `1.62.1`) is non-breaking per `npm`'s
  own classification and was applied; Electron's fix requires
  `--force` and a breaking major bump (`33` → `43`) and was
  **deliberately not applied** — that decision belongs to the project
  owner, not this pass (see "Remaining blockers" below).
- Full real Mac app walkthrough via Playwright's Electron driver
  against the actual packaged app: window launch, CSV worklist import
  through the real file picker, Confirm Queue, Start Batch, a
  synthetic batch completing with drafts saved and nothing signed,
  the resulting `queue-state.enc` confirmed to be genuinely opaque
  ciphertext on disk (real `safeStorage`/Keychain-backed path, not a
  test double), and a mid-batch Stop click.

### Two real issues found and fixed

1. **A safety-relevant race in Pause/Resume/Stop.** The desktop app's
   `batch:start` IPC handler assigned its `runningBatch` handle — and
   therefore the only reference `batch:pause`/`batch:unpause`/
   `batch:emergencyStop` had to the running batch's control object —
   only *after* `startSyntheticBatch`'s `chromium.launch()` resolved.
   A real Chromium launch is not instantaneous. A Stop (or Pause)
   request arriving during that window found nothing to attach to and
   was silently dropped, with no error and no indication to the RN;
   the batch then started moments later with a brand-new,
   never-stopped control, exactly as if Stop had never been clicked.
   Reproduced for real: clicking Stop within tens of milliseconds of
   Start Batch let all 4 queued entries complete anyway. Root-caused
   by adding temporary debug logging to the actual IPC handler,
   rebuilding, and capturing the Electron main process's real stdout —
   confirmed `runningBatch` really was `undefined` at the moment
   `batch:emergencyStop` fired. Fixed by having `startSyntheticBatch`
   accept an optional pre-created control (`batch-runner.ts`) and
   having `ipc-handlers.ts` create that control *synchronously*, before
   the browser launch even starts, so a concurrent Pause/Stop request
   always has something correct to act on. Regression test:
   `tests/integration/batch-stop-race.test.ts` (a control stopped
   before the batch's browser finishes launching now correctly results
   in zero entries processed). Re-verified against the real app,
   including a real UI Stop-button click: 0/4 entries reached a
   terminal state, down from 4/4 before the fix.
2. **`npm run lint:types` (`tsc -b --noEmit`) was not self-sufficient
   on a clean checkout.** TypeScript's project-references build mode
   requires each referenced composite project (`packages/contracts`,
   `packages/rules`, etc.) to actually emit its own declarations for
   downstream projects to resolve against; a blanket `--noEmit` across
   the whole graph conflicts with that on a tree with no pre-existing
   `dist`/`.tsbuildinfo` state, failing with `TS6310: Referenced
   project '...' may not disable emit`. It had only ever appeared to
   work because leftover build state from earlier development sessions
   happened to already be on disk. Fixed by dropping `--noEmit` from
   the `lint:types` script (`package.json`) — the emitted output is
   already gitignored and already routinely removed before every
   commit, exactly like every other `tsc -b` invocation used
   throughout this project's history; there was never a reason for
   this one script to differ. Verified standalone on a tree with
   `dist-types`/`.tsbuildinfo` fully removed: exit 0.

   Separately (not a repository issue): mid-pass, a fresh `npm ci` +
   `npm audit fix` sequence left 129 empty, oddly-permissioned
   duplicate directories scattered across dozens of unrelated
   third-party packages under `node_modules` (e.g. `node_modules/
   @types/node 2`, `node_modules/express/lib 2`, ...) — the signature
   of an interrupted/raced package extraction, not anything this
   repository's code did. Remediated by removing `node_modules`
   entirely and reinstalling clean (`npm ci` again, exit 0, zero
   duplicate directories afterward). Noted here for completeness, not
   filed as a code defect.

### Updated test totals

**137 tests, 0 failing, 0 skipped** (68 unit + 62 integration + 5
security + 2 e2e) — up from 135 at the end of Phase 2 (+2: the new
`batch-stop-race.test.ts` regression coverage).

### Remaining blockers

Unchanged from Phase 2, plus one new organizational item: whether to
accept Electron's breaking `33` → `43` upgrade to close the one
remaining `npm audit` high-severity advisory is a decision for the
project owner, not something this pass applied unilaterally.

### Readiness decision

**PASS — validated for synthetic development on this Mac.** Every
required check passed with a genuinely captured exit code, zero tests
were skipped, and the one safety-relevant defect found (the Pause/
Resume/Stop race) was root-caused, fixed with the smallest change
consistent with the existing architecture, covered by a regression
test, and re-verified against the real packaged app before being
called fixed. Nothing here changes Production Draft Mode's status —
the real Devero adapter remains `enabled: false` / `status:
"UNCONFIGURED"`, and live-EHR readiness still depends entirely on the
organizational track in `docs/DEPLOYMENT_CHECKLIST.md`.
