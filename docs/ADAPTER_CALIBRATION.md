# Adapter Calibration Mode

Calibration Mode exists to build a **patient-free structural contract**
for a real EHR page without ever recording a value, a patient header, or
credentials. It's the only sanctioned way to learn real selectors — this
project never guesses them.

## What the recorder captures

`adapters/schema/src/recorder.ts`'s `extractCalibrationStructure()` is a
single, flat, self-contained function (see the file-level comment for
why it must stay flat) that walks
`input, select, textarea, a[id], [data-rn-key]` elements and records,
per element:

- a selector (its `id`, else `data-rn-key`, else `name` attribute)
- how many elements that selector matches right now (zero/multiple is
  flagged as a warning, never silently accepted)
- tag name and `<input>` type
- an accessible label (`aria-label`, an associated `<label for>`, or an
  enclosing `<label>`'s text)
- for `<select>`, its option **values** (the vocabulary, not the current
  selection)

It never reads `.value`, `.textContent` of arbitrary containers, patient
headers, MR numbers, dates, or narrative content. This is verified in
`tests/integration/adapter-recorder.test.ts`, which asserts the
recorder's JSON output for a page never contains the synthetic patient's
name, MR, or date, and never captures the page's identity spans at all
(they carry no `data-rn-key` and aren't form controls).

## Lifecycle

1. **Capture**: run the recorder against a facility-approved training
   tenant page (never a live record). Output is a `CalibrationCandidate`
   (`packages/contracts/src/adapter.ts`) — structure only, `approved:
   false`.
2. **Review**: an RN/IT reviewer inspects every candidate selector,
   its zero/multiple-match warnings, and its accessible label, and
   decides which correspond to which real form field. This is a human
   step — nothing here infers field meaning automatically.
3. **Compile**: an approved set of candidates becomes a `FormAdapter`
   allowlist (see [FORM_MATRIX_GUIDE.md](FORM_MATRIX_GUIDE.md)),
   excluding every prohibited field by design.
4. **Validate**: `npm run adapter:validate -- path/to/adapter.json`
   checks the result against the strict schema
   (`adapters/schema/src/validate.ts`) before it's ever considered for
   install. Validity is necessary, not sufficient — it doesn't grant
   clinical approval.
5. **Version**: the adapter's `layoutFingerprint` ties it to the exact
   observed layout. `packages/rules`'s `verifyLayoutVersion` (and
   `packages/form-engine`'s `detectLayoutFingerprint`, tested against a
   deliberately drifted synthetic page in
   `tests/integration/form-engine.test.ts`) invalidates the adapter the
   moment the live structure no longer matches.

## What's implemented vs. what's still manual

Implemented and tested: structural extraction, zero/multiple-match
detection, patient-free guarantee, schema validation, layout-fingerprint
drift detection.

Still manual, by design: deciding which candidate selector maps to
which real field, and RN/IT sign-off that a field is safe to allowlist.
No automated process in this codebase ever promotes a calibration
candidate into an active allowlist entry on its own.

## The real Devero adapter

No calibration pass against the real Devero tenant has been run. See
[DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) for what's required
before one is attempted, and [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)
for the current state.
