# Developer Guide

## Toolchain

This project uses a **project-local** Node.js toolchain — nothing was
installed system-wide. Every command below assumes it's on `PATH`:

```bash
source scripts/env.sh   # puts .toolchain/node/bin on PATH for this shell
```

(If `.toolchain/node` doesn't exist yet, download Node from
[nodejs.org](https://nodejs.org) into `.toolchain/node` yourself, or set
up your own Node ≥22 and skip `env.sh`.)

Also required:
- **Swift** (ships with Xcode Command Line Tools) — builds `ocr-helper/`.
- **Google Chrome** — for loading the extension and running extension/e2e tests.

Nothing else is installed globally. `npm install` at the repo root
installs everything else into the project's own `node_modules/`.

## First run

```bash
npm install
npm run setup     # builds every package, the OCR helper, the extension, the desktop app; runs the security scan
```

## Day-to-day commands

```bash
npm run synthetic-ehr:start                        # local synthetic EHR on :4173
npm run start --workspace=@rn-doc-runner/desktop    # Electron app (builds first)
npm run build --workspace=@rn-doc-runner/extension  # rebuild the extension bundle after editing extension/src
npm test                                             # unit + integration
npm run test:security                                # security-scan tests (build first: they no longer skip)
npm run test:e2e                                     # builds the extension, runs e2e (real Chromium + real Electron)
npm run test:all                                     # everything
npm run test:ci                                      # exactly what .github/workflows/ci.yml runs
npm run lint:types                                   # tsc -b across the whole workspace graph
npm run security:scan                                # static scan of the built bundles (requires build:production)
```

`security:scan` and `test:security` inspect **built** artifacts and fail
closed when they are absent — run `npm run build:production` first. An
unbuilt tree reports `missing_build_artifact` and exits nonzero rather
than reporting a pass.

Load the extension in real Chrome: `chrome://extensions` → Developer
mode → Load unpacked → select `extension/`. Its manifest restricts
`host_permissions` to `http://localhost:4173/*` only (Synthetic
Development Mode) — it cannot reach any other origin.

## Monorepo map (see also the README)

The **rule engine** (`packages/rules`) is the single source of truth for
every safety-critical deterministic check — identity, chronology,
allowlist matching, fail-closed behavior. It has no DOM/Electron/Chrome
dependency and is unit-tested directly (`tests/unit/rules.test.ts`).

`packages/form-engine`'s `dom-reader.ts` functions are written to be
**dual-purpose**: they run unmodified either injected into a Playwright
`page.evaluate()` call (our own tests) or inlined into the Chrome
extension's content script (production). See the file-level comment
there — and in `adapters/schema/src/recorder.ts` — for why every
function there is flat (no nested named consts/functions): esbuild's
`keepNames` transform wraps named bindings in an `__name()` helper call
that doesn't survive `Function.prototype.toString()` serialization into
an isolated browser context.

`packages/queue-engine`'s `batch-machine.ts` is the actual state
machine — `processQueueEntry` drives one document through
`OPEN_CURRENT → VERIFY_CURRENT → FIND_PREDECESSOR → ... → SAVE_PAGE →
DRAFT_COMPLETE/NEEDS_REVIEW/BLOCKED`, and `runBatch` drives a whole
queue, never stopping on one entry's failure and never replaying an
already-terminal entry on resume.

## Adding a new form-version adapter

1. Read the real (or training-tenant) form structure using **Adapter
   Calibration Mode** — see [ADAPTER_CALIBRATION.md](ADAPTER_CALIBRATION.md).
   Never guess selectors.
2. Write a `FormAdapter` (see `packages/contracts/src/form.ts` for the
   schema) listing only RN-approved repeatable controls per page. See
   [FORM_MATRIX_GUIDE.md](FORM_MATRIX_GUIDE.md) for the exact shape and
   worked examples in `adapters/synthetic/src/snv-v1.ts` /
   `recert-v1.ts`.
3. Validate it: `npm run adapter:validate -- path/to/adapter.json`.
3. Add synthetic EHR fixtures exercising it (`synthetic-ehr/src/fixtures.ts`)
   and integration tests before considering it done.

## Running a single test file

```bash
node --import tsx --test tests/integration/batch-machine.test.ts
```

## Debugging the Electron app

```bash
npx electron --remote-debugging-port=9333 apps/desktop
```
then connect with Playwright's `chromium.connectOverCDP("http://localhost:9333")`
or point Chrome's own `chrome://inspect` at it. This is how the desktop
app's IPC flow was verified end-to-end during development (see
`docs/BUILD_REPORT.md`).

## Code style notes worth knowing before you touch the rule engine

- **Never** compare dates as strings once they need to represent the
  same calendar day from two different sources (EHR-rendered vs.
  OCR/CSV-derived) — compare via `rules.parseUsDate(...)` epoch values.
  Get this wrong and you'll reproduce a real bug found during M17: OCR
  normalized to `7/28/2026`, the EHR rendered `07/28/2026`, and an exact
  string match silently failed to find the pending row.
- **Never** rely on Vision's (or any OCR) "line" array order as row
  order — see `queue-engine/src/ocr/ocr-line-parser.ts`'s
  `reconstructRows`, which clusters by bounding-box Y-coordinate instead.
- **Never** add a nested named function/const inside a function meant to
  run via `page.evaluate` — see the dual-purpose note above.
