# Deployment Checklist

This gates any move beyond Synthetic Development Mode. It implements
RN DOC OS's `12_LOCAL_OPERATOR/DEPLOYMENT_GATE.md` in terms of this
repository's actual artifacts. **None of these items are complete as of
this build** — see [BUILD_REPORT.md](BUILD_REPORT.md).

Do not set `adapters/devero-disabled`'s `enabled: true` (or replace it
with a configured adapter) until every applicable box below is checked:

- [ ] Facility authorizes the exact extension, EHR origin, users, forms,
      and draft-only scope in writing.
- [ ] EHR/vendor terms and organizational access policy permit this
      automation.
- [ ] Security/IT reviews this repository's source, the extension's
      requested permissions (`extension/manifest.json`), installation
      method, and update process.
- [ ] `npm run security:scan` passes against the production build, and
      a facility reviewer independently confirms no external endpoint,
      analytics SDK, or dynamic code exists in the packaged extension.
- [ ] A production manifest is generated from
      `extension/manifest.production-template.json` with the exact real
      EHR origin (never a wildcard) as the **only** host permission —
      never reuse the Synthetic Development Mode manifest.
- [ ] A sanitized site adapter (via Adapter Calibration Mode — see
      [ADAPTER_CALIBRATION.md](ADAPTER_CALIBRATION.md)) contains no
      patient values or credentials.
- [ ] Every identity selector in the adapter is unique and validated
      against the real training tenant (`npm run adapter:validate`,
      then live verification — schema validity alone is not enough).
- [ ] Every allowlisted field has RN approval for the exact form
      version (see [FORM_MATRIX_GUIDE.md](FORM_MATRIX_GUIDE.md)).
- [ ] The full test suite passes against the real training tenant
      structure (a facility-approved training-tenant test layer beyond
      what's in this repo — see [TESTING.md](TESTING.md)).
- [ ] The adapter passes layout-drift and non-unique-selector tests
      against the real training tenant.
- [ ] A facility-approved training tenant passes the full acceptance
      suite equivalent to `tests/e2e/acceptance.test.ts`.
- [ ] The RN can see every proposed change highlighted before any
      apply — confirmed in the real environment, not just synthetic.
- [ ] Confirm, in the real environment, that no configured Save Draft
      control can be confused with Sign/Submit/Send to
      Office/Finalize — `packages/form-engine`'s
      `validateSaveDraftLabel` + `isFinalizationLabel` are the code-level
      guard; this step is the human confirmation that the *real* button
      labels actually match what was assumed.
- [ ] Session clearing is verified after tab closure, Clear, extension
      reload, and browser restart, in the real environment.
- [ ] A rollback procedure (below) is rehearsed.
- [ ] Record approval artifacts outside this repository per your
      organization's policy. Never store patient information in
      evidence.

## Rollback procedure

Removing RN DOC Runner never modifies any EHR record — it only ever
prepared/highlighted/saved drafts through the same manual save
mechanism a person would use.

1. Chrome: `chrome://extensions` → find RN DOC Runner → **Remove**.
2. Desktop app: `npm run uninstall` (removes the native messaging host
   manifest and the app's own encrypted local data — nothing else).
3. Confirm no native messaging host manifest remains:
   `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.rndocrunner.native_host.json`
   should not exist (`npm run uninstall-host --workspace=@rn-doc-runner/native-host`
   also removes it directly).
4. Delete the project folder if you want no trace left on disk.

No record needs correcting as part of rollback: everything RN DOC
Runner ever does stops at a saved draft, which the RN reviews and either
keeps or corrects through the EHR's own normal editing — exactly as if
she'd typed it herself.
