# Security Model

This describes what's actually enforced in this codebase today, and
where. It narrows RN DOC OS's canonical policy (`01_CORE/*`,
`12_LOCAL_OPERATOR/*`); it never broadens it.

## No AI, no network, no analytics in the live-record path

- The rule engine (`packages/rules`), form engine, and extension content
  script contain no AI/LLM calls of any kind.
- The Chrome extension's `manifest.json` sets
  `content_security_policy.extension_pages: "connect-src 'none'"` and its
  bundled JS contains no `fetch`, `XMLHttpRequest`, `WebSocket`, or
  `sendBeacon` call — enforced by `npm run security:scan`
  (`scripts/security-scan-lib.ts`), which scans the **built** bundle,
  not just the source, and is itself tested against a deliberately
  poisoned fixture to confirm it actually catches violations
  (`tests/security/security-scan.test.ts`).
- No analytics/crash-reporting SDK reference (Google Analytics, Segment,
  Mixpanel, Sentry, Bugsnag, Amplitude, FullStory, Hotjar, Datadog) is
  permitted anywhere in the extension or desktop renderer bundle; the
  scan checks for all of them by name.
- The desktop app's main process is allowed to make **local** network
  calls only — to the synthetic EHR (`localhost:4173`, Synthetic
  Development Mode) and to its own local Unix-socket bridge. This is
  enforced, not just stated: the scan rejects any `http(s)` destination
  literal in `apps/desktop/dist/main.cjs` or `preload.cjs` whose host is
  not loopback (`localhost`, `127.0.0.0/8`, `[::1]`), rule
  `non_loopback_network_destination`, and rejects `navigator.sendBeacon`
  and `new WebSocket(...)` outright (neither has a local-only use here).
  `fetch`/`XMLHttpRequest` remain available to the main process for
  loopback use. The main process is scanned for analytics/dynamic-code
  the same as everything else.
  **Known limit of this gate:** it is a static literal scan, so a
  destination assembled at runtime from fragments or read from an
  environment variable is outside what it can see. It stops a bundle
  from gaining a hardcoded remote endpoint; it is not a sandbox.
- The scan **fails closed on missing inputs**. Every artifact it expects
  (`extension/dist/`, `apps/desktop/dist/renderer/`, `main.cjs`,
  `preload.cjs`) must exist and be non-empty, or the scan reports
  `missing_build_artifact` and exits nonzero telling you to build first.
  A build gate that passes because it could not find what it was meant
  to inspect is worse than no gate; `npm run security:scan` therefore
  requires `npm run build:production` to have run.

## Exact-origin restriction

`extension/manifest.json`'s `host_permissions` lists
`http://localhost:4173/*` only. The real EHR origin is **not present**
in the shipped manifest — a production build would need a separate,
explicitly-generated manifest (`extension/manifest.production-template.json`),
never checked in with a real origin filled in, gated by the deployment
checklist.

## Identity and allowlist gates (the actual safety mechanism)

Every mutation in this system passes through `packages/rules`:

- `verifyIdentity` — exact patient/MR/form/page match, exact
  authorized-author match, and a strictly-earlier source date, all
  fail-closed on any missing/unparseable field.
- `buildPlan` — only controls **explicitly present in the current
  page's field allowlist** are ever considered; every other source
  control is silently ignored. Checkbox `false→true` only; radio only
  when the destination has no contradictory selection; select only to
  an explicitly allowlisted value; free text only for the exact literal
  `"GA"` (not `"GA "`, not `"GA."`, not `"ga"`).
- `isFailClosed` — any unresolved item blocks the entire plan from
  being applied.
- Selector uniqueness is enforced on every read that can *change* a
  record or gate a change: identity fields, allowlisted controls, and
  the Save Draft button — a selector matching zero or multiple elements
  is always a hard stop, never a first-match fallback. The one
  documented exception is `readHiddenFieldValuesInPage`
  (`packages/form-engine/src/dom-reader.ts`), which reads hidden
  red-link *status* fields with `document.querySelector` (first match).
  That path is read-only and its result can only ever block a save, so a
  first match cannot cause a mutation; it is nonetheless not covered by
  the uniqueness rule, and "every read" should not be read as "every
  read in the codebase".

The Draft Save Adapter (`packages/form-engine/src/draft-save.ts`)
re-checks identity, plan resolution, applied-transition verification,
and (for Recert) red-link completeness **immediately before** its one
click, and independently rejects any control whose visible label
matches `/sign|submit|finalize|lock|complete|send.?to.?office/i` even
if misconfigured to point at the wrong element —
`tests/unit/draft-save-safety.test.ts` asserts, by scanning the
package's own exports, that no function anywhere in `form-engine` is
capable of targeting a finalization control by name.

## No credential handling

Nothing in this codebase reads, stores, or enters a password, session
token, or cookie. The RN signs into the EHR herself, in her own browser
tab; RN DOC Runner only ever reads already-rendered page content through
exact selectors.

## Nonclinical logging

`packages/contracts/src/audit.ts`'s `AuditEventSchema` has no free-text
"value" field structurally — it can only carry an event type, counts,
and enumerated nonclinical codes. `packages/contracts/src/batch.ts`'s
`ExceptionRecord` carries a `nonclinicalDetail` string; batch-machine
tests assert exception details never contain a patient name, MR number,
or date (`tests/integration/batch-machine.test.ts`).

## Encrypted-at-rest resumable state

`apps/desktop/src/main/secure-store.ts` encrypts persisted batch state
via an injectable `EncryptionBackend` — the real backend
(`electron-encryption-backend.ts`) uses Electron's `safeStorage`
(macOS Keychain-backed); tests use a fake backend so the encryption
policy itself isn't what's under test, the store's behavior is
(`tests/unit/desktop-main.test.ts`).

## Prohibited-field guard

`packages/rules`'s `assertFieldNotProhibited` is a keyword-based
defense-in-depth check (vitals, pain, wound, dose/route/medication,
comment, narrative, signature, finalization terms). It is run at build
time, in `tests/unit/adapter-allowlist-prohibition.test.ts`, over the
label and key of **every** entry of **every** allowlist exported by the
adapter packages — the adapters are discovered from the packages'
exports by shape, not listed by hand, so a new adapter or a new field is
covered the moment it is exported. It is not called at runtime; the
authoritative control remains the allowlist itself never containing
those fields.

That test carries a short, deliberately awkward
`KNOWN_LABEL_GUARD_EXCEPTIONS` ledger: three currently-shipped labels
("Certification period", "Medication list reviewed with patient/
caregiver", "Next medication review frequency") that this guard rejects
the first time it is actually pointed at real adapters. They look like
false positives of an over-broad keyword guard rather than genuinely
prohibited fields, but which side to change — the label or the pattern
— is a product decision that has not been made. The ledger is
self-invalidating: an entry that stops being shipped, or stops being
flagged, fails the suite.

Note the guard's vocabulary is keyword-based and therefore does **not**
cover every clinical assessment. `SNV-v1` allowlists
"Ambulation: Independent"/"Requires assist" and "Goal status: Met"/"Not
met", which are clinical assessments that no keyword in
`PROHIBITED_FIELD_LABEL_PATTERN` matches. They pass the guard by
design. Whether they belong in an allowlist is an RN scope question,
not something this pattern decides.

## The real Devero adapter

`adapters/devero-disabled/src/index.ts` ships and is scanned to confirm
`enabled: false` and `status: "UNCONFIGURED"`, with every identity
selector empty and an empty allowlist. The scan checks **absence** as
well as presence — any `enabled: true`, or any `status:` literal other
than `"UNCONFIGURED"`, anywhere in that file fails the build, so a
second exported adapter object cannot slip past a presence-only check.
Comments are stripped before the check so the file's own prose about
not setting `enabled: true` is not mistaken for code. When a build has
emitted `adapters/devero-disabled/dist/index.js`, that artifact is
checked with the same rules. No Devero selector has been
guessed or reverse-engineered anywhere in this codebase. Turning it on
is a deliberate, documented, out-of-band process — see
[DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md).

## What this model does **not** cover

It is not a substitute for facility security/IT review, an access
control audit, a signed release process, or your organization's own
regulatory/contractual obligations. See
[DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) for what's still
required before any live use.
