# RN DOC OS Traceability

Mapping of RN DOC OS's `09_TESTS/TEST_CASES.md` (T01–T28) to what's
actually implemented and tested in this repository. Where this build
does more than the original RN DOC OS v1.1 Local Operator scope (which
explicitly deferred red-link/batch-date-update work), that's called out
— this is not a re-statement of the old scope, it's what's true today.

| ID | Scenario | Status | Where |
|---|---|---|---|
| T01 | Source User exactly authorized | ✅ Implemented & tested | `tests/unit/rules.test.ts` "T01" |
| T02 | Source User differs | ✅ Implemented & tested | `tests/unit/rules.test.ts` "T02" |
| T03 | Multiple earlier same-type documents → nearest selected | ✅ Implemented & tested | `tests/unit/predecessor.test.ts` "T03"; end-to-end in `tests/integration/navigation.test.ts` |
| T04 | Qualifying Recert in older Episode | ✅ Implemented & tested | `tests/unit/predecessor.test.ts` "T04"; end-to-end in `tests/integration/navigation.test.ts` |
| T05 | Source/destination pages differ | ✅ Implemented & tested | `tests/unit/rules.test.ts` "T05"; `tests/integration/form-engine.test.ts` "page_mismatch" |
| T06 | Source has vital signs | ✅ Implemented & tested | Prohibited-field exclusion asserted per adapter in `tests/integration/adapter-recorder.test.ts` |
| T07 | Source text exactly `GA` | ✅ Implemented & tested | `tests/unit/rules.test.ts` "T07" |
| T08 | Source text `GA `, `GA.`, other | ✅ Implemented & tested | `tests/unit/rules.test.ts` "T08" (caught a real whitespace-trimming bug during M2) |
| T09 | Approved checkbox compatible | ✅ Implemented & tested | `tests/unit/rules.test.ts` "T09" |
| T10 | Plan header checkbox selects all | ✅ **Implemented** (beyond v1.1 scope) | `packages/form-engine/src/red-link.ts`; `tests/integration/red-link.test.ts` |
| T11 | Rows hidden in collapsed control | ✅ **Implemented** (beyond v1.1 scope) | Same; collapsed-group expansion + defense-in-depth test for skipping expansion |
| T12 | Current Visit Date visible | ✅ Implemented & tested | Identity read in `packages/form-engine/src/compare.ts`; exercised throughout integration tests |
| T13 | Batch date update | ✅ **Implemented** (beyond v1.1 scope) | `packages/form-engine/src/red-link.ts`; `tests/integration/red-link.test.ts` |
| T14 | Discontinued Date present, never changed | ✅ Implemented & tested | `tests/integration/red-link.test.ts` "changing the Discontinued Date is caught" |
| T15 | Verified popup link ignores click | ⚠️ Not applicable in this build | No "unexpected popup" scenario exists in the synthetic EHR yet; RN DOC Runner's only modal interaction is the configured red-link modal, which is always expected |
| T16 | Field structure mismatch | ✅ Implemented & tested | `tests/unit/rules.test.ts` "T16" |
| T17 | Apply succeeds | ✅ Implemented & tested | `tests/integration/form-engine.test.ts` end-to-end apply test |
| T18 | Sign/Submit/Send to Office visible, never targeted | ✅ Implemented & tested | `tests/unit/rules.test.ts` "T18"; `tests/unit/draft-save-safety.test.ts` (export scan); `tests/integration/synthetic-ehr.test.ts` (finalization buttons are never `type="submit"`) |
| T19 | Patient or MR mismatch | ✅ Implemented & tested | `tests/unit/rules.test.ts` "T19" |
| T20 | Contradictory source/destination selections | ✅ Implemented & tested | `tests/unit/rules.test.ts` "T20/radio" |
| T21 | Unsupported form | ✅ Implemented & tested | `tests/integration/batch-machine.test.ts` (Wound Care Note → BLOCKED); `tests/e2e/acceptance.test.ts` (rejected at OCR/queue stage) |
| T22 | Identity selector zero/multiple matches | ✅ Implemented & tested | `tests/unit/rules.test.ts` "T22"; `packages/form-engine/src/dom-reader.ts` |
| T23 | Source date same/later than destination | ✅ Implemented & tested | `tests/unit/rules.test.ts` "T23" |
| T24 | Source/destination same tab | ✅ Implemented & tested | `rules.verifySeparateTabs`, directly unit-tested |
| T25 | Source or destination tab closes → session cleared | ⚠️ Implemented, not automated-tested | `extension/src/background.ts`'s `chrome.tabs.onRemoved` handler; no Playwright test simulates a real tab close against the live extension yet — see KNOWN_LIMITATIONS |
| T26 | Non-allowlisted control ignored | ✅ Implemented & tested | `tests/unit/rules.test.ts` "T26" |
| T27 | Destination contains different meaningful value | ✅ Implemented & tested | `tests/unit/rules.test.ts` "T27" |
| T28 | Extension package inspection | ✅ Implemented & tested | `npm run security:scan`; `tests/security/security-scan.test.ts`; `tests/e2e/extension.test.ts` loads and exercises the real built bundle |

**26 of 28 fully implemented and automated-tested. 1 not applicable to
this build's current scope (T15). 1 implemented but not yet covered by
an automated test (T25).**

## Module mapping

RN DOC OS's canonical policy modules (`01_CORE/*`) map to this
repository as follows — this repo **implements** them, it does not
redefine them:

| RN DOC OS module | This repo |
|---|---|
| `CORE-001` Lifecycle/hard stops | `packages/queue-engine/src/batch-machine.ts` states |
| `CORE-002` Role authority | `docs/USER_GUIDE.md` "What RN DOC Runner will never do" |
| `CORE-003` Safety/privacy | `docs/SECURITY_MODEL.md` |
| `CORE-004` Field classification | `packages/contracts/src/form.ts`, `docs/FORM_MATRIX_GUIDE.md` |
| `LOP-001` Local Operator lifecycle | `extension/src/content.ts`, `packages/form-engine` |
| `LOP-002` Privacy model | `docs/SECURITY_MODEL.md`, `scripts/security-scan-lib.ts` |
| `LOP-003` Site-adapter schema | `packages/contracts/src/adapter.ts`, `adapters/schema` |
| `LOP-004` Deployment gate | `docs/DEPLOYMENT_CHECKLIST.md` |
| `LOP-005` Synthetic/training validation | `docs/TESTING.md`, `synthetic-ehr/` |
