# Form Matrix Guide

How to write a `FormAdapter` — the per-form-version field allowlist that
is the actual authority for what RN DOC Runner is allowed to touch on a
given page. Schema: `packages/contracts/src/form.ts`. Worked, tested
examples: `adapters/synthetic/src/snv-v1.ts` and `recert-v1.ts`.

## Shape

```ts
{
  formType: "Skilled Nurse Visit Note",   // must exactly match the EHR's own displayed form title
  formVersion: "SNV-v1",                  // your own stable version id, tied to a layoutFingerprint
  layoutFingerprint: "synthetic-ehr-v1",  // see ADAPTER_CALIBRATION.md
  approved: true,                          // false until RN/IT sign-off
  pages: [
    {
      page: { formType, formVersion, pageLabel: "Page 1", pageIndex: 0 },
      allowlist: [ /* FieldAllowlistEntry, see below */ ]
    }
  ]
}
```

## Allowlist entry types

Every entry has `key` (a stable semantic id, e.g.
`"SNV-v1::page1::care_plan_reviewed"`), `selector` (exact, must resolve
to exactly one element), `type`, and `label`.

| type | extra required fields | eligible transition |
|---|---|---|
| `checkbox` | — | unchecked → checked, only when source is checked |
| `radio` | `group` | unchecked → the source's checked option, only when the destination has no contradictory selection in that group |
| `select` | `defaultValue`, `allowedValues[]` | default/empty → an explicitly allowlisted non-default value |
| `text` | `exactValue: "GA"` (the only value ever accepted) | empty → exactly the literal string `"GA"` — no whitespace, punctuation, or expansion |

`expectedOptions` (optional, on `select`) documents the full observed
option vocabulary for drift detection, separate from `allowedValues`
(what's actually allowed to be copied).

## What must never appear in an allowlist

Vital signs, pain scores, wound measurements, medication administration
facts (dose/route/time/reaction), any numeric current-assessment value,
comments, narratives, current-assessment findings, signatures, or any
Save/Sign/Submit/Send-to-Office/Finalize control. This is enforced by
convention (there's no "prohibited" flag on the schema — the entry
simply must not be written), checked by
`packages/rules`'s `assertFieldNotProhibited` as defense-in-depth, and
tested per-adapter (`tests/integration/adapter-recorder.test.ts`
explicitly asserts none of the synthetic adapters' keys contain
`pulse_rate`, `pain_score`, `wound_length_cm`, `visit_narrative`,
`wound_measurement_cm`, `assessment_narrative`, or `recert_narrative`).

## Templates

Empty, disabled starting points for the three named form types are the
synthetic adapters themselves with their `pages` array emptied out and
`approved: false` — copy `adapters/synthetic/src/snv-v1.ts` or
`recert-v1.ts` as a starting structure. A dedicated
`Med Admin Skilled Nurse Visit Record` adapter has not been built (see
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)); its allowlist would
follow the exact same pattern once real form structure is available
from Calibration Mode.

## Red-link (Recert Plan of Care) sections are separate

Red-link date-update automation is **not** a `FieldAllowlistEntry` — it
has its own `RedLinkSectionConfig` (`packages/form-engine/src/red-link.ts`),
one per exact configured section, never generalized from one section to
another. See `adapters/synthetic/src/recert-v1.ts`'s
`RECERT_V1_RED_LINK_CONFIGS` for the worked example.

## Before an adapter goes live

1. `npm run adapter:validate -- path/to/adapter.json`
2. Add synthetic EHR fixtures exercising every control type it declares.
3. Run it through the full batch pipeline
   (`tests/integration/batch-machine.test.ts` is the pattern to follow)
   and confirm: correct proposals, correct highlight, correct apply,
   correct re-verification, and that every prohibited field you'd expect
   to be excluded actually is.
4. RN/IT approval, recorded outside this repository per your
   organization's process (see
   [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)).
