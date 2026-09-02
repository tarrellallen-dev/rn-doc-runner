# Privacy and Repository Audit

Phase 2 / Task P2-5. Originally performed 2026-07-31 against the
private development repository, and re-run before this public release.

**Scope note for the public repository:** this repository was published
from a fresh, single initial commit containing the `main` working tree
only. It does not carry the private development history, so history
claims below describe that prior private repository, not this one.
Development branches were not published.

## Method

- `git ls-files` — every currently tracked file, checked by name for
  screenshots, worklist exports, credential-shaped filenames, and
  known session/auth-state file patterns.
- `git grep` across the current tree, and `git log --all -p` across
  every patch in history (not just current content), for: API keys,
  secret keys, passwords, bearer tokens, PEM private key headers, and
  SSN-shaped digit patterns (`###-##-####`).
- `git log --all --diff-filter=A --name-only` compared against current
  `git ls-files`, to check whether any file was ever added and later
  deleted — if so, its content would still be reachable in history.
- `git rev-list --objects --all` + `git cat-file --batch-check`,
  sorted by size, to check for any binary blob (image, PDF, HAR,
  archive) ever committed, anywhere in history.
- Manual review of every synthetic-patient name/MR pattern used across
  `synthetic-ehr/src/fixtures.ts` and every adapter, and of the one
  real-looking hostname in the repository (the disabled Devero
  adapter's `expectedOrigin`).

## Findings

**Nothing required deletion or remediation.** Specifically:

- **No file was ever added to `main`'s history and later removed.**
  Every file path added on `main` is present in the tree today. (The
  original audit's "exact match both ways" claim was scoped to `main`;
  development branches carried additional files and were not published.
  This public repository has a single commit, so the question does not
  arise here.)
- **No image, PDF, or other binary document has ever been committed.**
  The largest blobs in the entire history are `package-lock.json` and
  ordinary `.ts`/`.swift` source files. No worklist photo, scanned
  document, or screenshot exists anywhere in git history.
- **No credentials, API keys, tokens, passwords, or private key
  material** appear anywhere in the current tree or in any historical
  patch.
- **No cookies, browser storage-state files, HAR files, or other
  recorded real-system browser session** exist anywhere in the
  repository or its history — Synthetic Development Mode's Playwright
  runs never persist `storageState`, and no such file has ever been
  added.
- **No real patient name, MR number, or other PHI-shaped identifier**
  exists anywhere. Every synthetic patient uses a NATO-phonetic
  placeholder name (`Rehearsal Alpha` .. `Rehearsal Kilo`) with an
  obviously-synthetic MR (`SYN-1001` .. `SYN-1011`); the one non-fixture
  personal name in the codebase is `Nurse, Demo (RN)` — the
  neutral placeholder used as the expected-author identity value, not
  patient information. The operating RN's real name is supplied by
  local configuration and appears nowhere in this repository.
- **No real facility, tenant, or organization is named.** The disabled
  Devero adapter (`adapters/devero-disabled/src/index.ts`) previously
  hardcoded a real EHR tenant hostname carried over from Phase 1. It
  has been replaced with the placeholder
  `https://REPLACE_WITH_APPROVED_TENANT_ORIGIN.example` for this public
  release. The adapter remains inert regardless (`enabled: false`,
  `status: "UNCONFIGURED"`, no selectors, empty allowlist) and
  `npm run security:scan` fails the build if either flag changes
  without going through `docs/DEPLOYMENT_CHECKLIST.md`. A real origin
  must be supplied at deployment time, never committed.
- **No `.env`, credential file, or secret ever existed** in tracked
  history — `.gitignore` already excluded `.env`/`.env.*` from the
  very first commit.

## `.gitignore` hardening

Nothing above required remediation, but `.gitignore` gained explicit,
defense-in-depth exclusions (Phase 2 requirement) for categories that
could plausibly hold patient-adjacent data in the future even though
none of them are written by the app today: worklist import/export
directories, OCR input/output/debug directories, local-queue and
session-state file patterns beyond the two exact filenames already
excluded, generic export/screenshot patterns, log directories, HAR
files, browser storage-state files, and credential-shaped filenames.
See the "Phase 2 / Task P2-5" block in `.gitignore` for the exact list
and the reasoning comment above it (worklist imports are read from
their original location and never copied into the repo; OCR/PDF
previews render to the OS temp directory and are deleted immediately
after use — see `apps/desktop/src/main/ipc-handlers.ts`'s
`worklist:previewRow` handler).

## Scope note

This audit covers the repository itself (working tree + local git
history). It does not cover the host machine's OS-level temp
directories, Electron's `userData` directory, or anything outside this
git repository — those are addressed by the app's own retention
behavior (`packages/queue-engine`'s retention config,
`docs/SECURITY_MODEL.md`), not by a repository audit.
