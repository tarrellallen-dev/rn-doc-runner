# Testing

## Running the suite

```bash
npm test              # unit + integration (fast; ~15s)
npm run test:security # security-scan tests (needs extension+desktop already built)
npm run test:e2e       # builds the extension, then runs real-Chromium/real-Electron e2e (~15s)
npm run test:all        # everything
```

All layers use Node's built-in test runner (`node --test`) via `tsx` —
no separate test framework. Layers:

- **`tests/unit/`** — pure logic: the rule engine, contracts validation,
  CSV/date parsing, table-row reconstruction, predecessor selection,
  native-messaging framing, secure-store/queue-state-store,
  security-scan detection logic. No browser, no subprocess (except a
  couple of deliberate subprocess tests, see below).
- **`tests/integration/`** — real Playwright-driven Chromium against the
  real synthetic EHR (`synthetic-ehr/`): navigation, predecessor
  discovery, page comparison/apply, draft save, red-link automation, the
  full batch state machine, and the Calibration Mode recorder. Also a
  real subprocess test of the native-host wrapper
  (`tests/integration/native-host-process.test.ts`).
- **`tests/e2e/`** — loads the **actual built** Chrome extension bundle
  into a real Chromium profile and drives it via real
  `chrome.runtime.sendMessage` calls
  (`tests/e2e/extension.test.ts`), and the canonical acceptance test
  (`tests/e2e/acceptance.test.ts`): synthetic worklist image → real
  on-device OCR → queue → batch → completion summary.
- **`tests/security/`** — the security scan's own detection logic,
  proven against a deliberately poisoned fixture directory, against an
  entirely unbuilt tree (which must fail, not pass), and against the
  real build.

Current suite: **191 tests** — 95 unit, 81 integration, 13 security,
2 e2e. The unit and security layers plus `npm run security:scan` run on
every push and pull request in CI (`.github/workflows/ci.yml`, Linux)
and are verified green from a clean checkout there. The integration and
e2e layers are **not** in CI: they need a Playwright-installed Chromium
and, for `ocr-e2e`/`pdf-heic-import`/`acceptance`, the macOS-only
Swift/Vision OCR helper — see the comment block at the top of the
workflow for the full rationale, including what a macOS job would add.
The last full-suite, zero-skip run was the Mac validation pass in
[BUILD_REPORT.md](BUILD_REPORT.md).

`npm run test:ci` runs exactly what CI runs.

`npm run test:security` requires the bundles to be built first, and now
says so by failing rather than by passing: the scan reports
`missing_build_artifact` and exits nonzero on an unbuilt tree instead of
printing "Security scan passed", and the security suite no longer
self-skips its real-build assertion.

## T01–T28 (RN DOC OS) coverage

See [RN_DOC_OS_TRACEABILITY.md](RN_DOC_OS_TRACEABILITY.md) for the exact
mapping of each RN DOC OS test case to the test(s) implementing it here.

## Extended coverage beyond T01–T28

OCR rotation/orientation correction, OCR table-row reconstruction
(bounding-box clustering), duplicate worklist rows, worklist priority
vs. original-order sorting, current-document ambiguity (duplicate
pending rows), predecessor ambiguity, older-episode predecessor,
selector zero/multiple-match, layout-fingerprint drift, prohibited-field
exclusion (per adapter), checkbox/radio/select/exact-`GA` transitions
and their negative cases, red-link completeness (unexpanded collapsed
group, partial row selection, Discontinued Date tampering — all as
defense-in-depth checks against the synthetic EHR's own client-side
validation), save success/validation-error/session-expired/ambiguous,
duplicate-save prevention (both "already in prior-successful-keys" and
"EHR itself reports ambiguous on a genuine double click"), crash/resume
(never replaying a terminal entry), emergency stop, queue continuation
after failure, finalization-control impossibility (a standing export
scan, not just a behavioral test), retention-based data deletion, and
the network-exfiltration static scan.

## Writing a new test

- Prefer `tests/integration/*.test.ts`'s pattern: `withServer()` spins
  up the synthetic EHR on an ephemeral port and calls
  `POST /debug/reset` first — tests must be order-independent within a
  file.
- If your test drives a real browser, launch via `chromium.launch()` in
  a `test.before`/`test.after` pair, one browser per file, one
  `page`/tab per scenario.
- If your test evaluates code inside a page (`page.evaluate`), keep the
  evaluated function **flat** — no nested named consts/functions. See
  `packages/form-engine/src/dom-reader.ts`'s file comment for why; this
  bit two milestones during development (M12 and M6) before the pattern
  was established.
- Never put real patient data anywhere in a test — synthetic fixtures
  only, and `tests/integration/batch-machine.test.ts` explicitly asserts
  exception details never leak a patient name/MR/date.

## What isn't (and can't be) tested here

Anything requiring the real Devero tenant. No test in this repository
touches, or is capable of touching, a live EHR — see
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
