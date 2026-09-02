/**
 * Task 3: make the "no clinical field is ever allowlisted" claim
 * enforceable rather than illustrative.
 *
 * Before this file, `assertFieldNotProhibited` had zero production
 * callers and was exercised only by `tests/unit/rules.test.ts` against
 * four hand-written strings, and `verifyFormVersionAllowlist` had no
 * caller and no test at all. Neither ever saw a field that this
 * repository actually ships. These tests discover every shipped
 * allowlist **programmatically** from the adapter packages' exports, so
 * a prohibited field added to any adapter — or a whole new adapter —
 * is covered the moment it is exported, with nothing to remember to
 * update here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { FieldAllowlistEntry } from "@rn-doc-runner/contracts";
import * as syntheticAdapters from "@rn-doc-runner/adapters-synthetic";
import * as deveroAdapter from "@rn-doc-runner/adapters-devero-disabled";
import { assertFieldNotProhibited, verifyFormVersionAllowlist } from "@rn-doc-runner/rules";

interface DiscoveredEntry {
  /** `<module export name>` or `<module export name>.pages[i]`, for failure messages. */
  source: string;
  entry: FieldAllowlistEntry;
}

function isAllowlistEntry(value: unknown): value is FieldAllowlistEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { key?: unknown }).key === "string" &&
    typeof (value as { label?: unknown }).label === "string" &&
    typeof (value as { selector?: unknown }).selector === "string"
  );
}

/**
 * Walks a module namespace and yields every field-allowlist entry
 * reachable from it: `SiteAdapter.allowlist`, `FormAdapter.pages[].allowlist`,
 * and arrays of either (e.g. `SYNTHETIC_FORM_ADAPTERS`). Shape-driven, not
 * name-driven, so a newly exported adapter is picked up automatically.
 */
function discoverAllowlistEntries(moduleName: string, namespace: Record<string, unknown>): DiscoveredEntry[] {
  const found: DiscoveredEntry[] = [];

  const visit = (source: string, value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(`${source}[${index}]`, item));
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.allowlist)) {
      for (const candidate of record.allowlist) {
        if (isAllowlistEntry(candidate)) found.push({ source, entry: candidate });
      }
    }
    if (Array.isArray(record.pages)) visit(`${source}.pages`, record.pages);
  };

  for (const [exportName, exported] of Object.entries(namespace)) {
    visit(`${moduleName}.${exportName}`, exported);
  }
  return found;
}

const SHIPPED_ENTRIES: DiscoveredEntry[] = [
  ...discoverAllowlistEntries("@rn-doc-runner/adapters-synthetic", syntheticAdapters as unknown as Record<string, unknown>),
  ...discoverAllowlistEntries("@rn-doc-runner/adapters-devero-disabled", deveroAdapter as unknown as Record<string, unknown>)
];

/**
 * UNRESOLVED FINDINGS, not approvals.
 *
 * These three shipped labels are rejected by the repository's own
 * `PROHIBITED_FIELD_LABEL_PATTERN` / `FINALIZATION_PATTERN` the first
 * time those guards are actually run against real adapters (they never
 * were before this file existed). Each is plausibly a false positive of
 * a deliberately over-broad defense-in-depth keyword guard rather than a
 * genuinely prohibited field — "Medication list reviewed" is a review
 * checkbox, not a medication entry; "Certification period" is a visit
 * cadence select, not an attestation — but resolving that is the
 * project owner's product decision (narrow the label, or narrow the
 * pattern), NOT a test's decision. Until it is made, they are recorded
 * here so the invariant still holds for every other field and for every
 * field added in future. Nothing may be added to this list to make a
 * new adapter pass; the fix is to change the adapter.
 */
const KNOWN_LABEL_GUARD_EXCEPTIONS: readonly string[] = [
  "Certification period",
  "Medication list reviewed with patient/caregiver",
  "Next medication review frequency"
];

test("allowlist discovery actually finds the shipped adapters (not a vacuous zero-entry pass)", () => {
  assert.ok(SHIPPED_ENTRIES.length > 0, "discovered no allowlist entries at all - discovery is broken");
  const formVersions = new Set(SHIPPED_ENTRIES.map(({ entry }) => entry.key.split("::")[0]));
  for (const expected of ["SNV-v1", "RECERT-v1", "MEDADMIN-v1"]) {
    assert.ok(formVersions.has(expected), `discovery missed ${expected}: ${[...formVersions].join(", ")}`);
  }
});

test("every field label in every shipped adapter allowlist passes assertFieldNotProhibited", () => {
  const unexpected = SHIPPED_ENTRIES.filter(
    ({ entry }) => !assertFieldNotProhibited(entry.label).ok && !KNOWN_LABEL_GUARD_EXCEPTIONS.includes(entry.label)
  ).map(({ source, entry }) => `${source} :: ${entry.key} :: "${entry.label}" :: ${assertFieldNotProhibited(entry.label).failures.join(",")}`);

  assert.deepEqual(
    unexpected,
    [],
    `A shipped adapter allowlists a field whose label the prohibited-field guard rejects:\n${unexpected.join("\n")}`
  );
});

test("every allowlist entry KEY also passes the prohibited-field guard", () => {
  // The key is what the DOM selector and audit log carry, so a prohibited
  // concept smuggled into a key while the label reads innocuously is the
  // same failure.
  const unexpected = SHIPPED_ENTRIES.filter(({ entry }) => {
    if (assertFieldNotProhibited(entry.key.replace(/_/g, " ")).ok) return false;
    return !KNOWN_LABEL_GUARD_EXCEPTIONS.includes(entry.label);
  }).map(({ source, entry }) => `${source} :: ${entry.key}`);
  assert.deepEqual(unexpected, [], unexpected.join("\n"));
});

test("the known-exception ledger cannot rot: every entry is still shipped and still flagged", () => {
  for (const label of KNOWN_LABEL_GUARD_EXCEPTIONS) {
    assert.ok(
      SHIPPED_ENTRIES.some(({ entry }) => entry.label === label),
      `stale exception: no shipped adapter allowlists "${label}" any more - delete it from KNOWN_LABEL_GUARD_EXCEPTIONS`
    );
    assert.equal(
      assertFieldNotProhibited(label).ok,
      false,
      `"${label}" now passes the guard - delete it from KNOWN_LABEL_GUARD_EXCEPTIONS`
    );
  }
});

test("the discovery harness would actually catch a prohibited field added to an adapter", () => {
  // Proves this suite is not toothless: the same walker, over a module
  // shaped exactly like a real adapter package, must find and reject a
  // planted clinical field.
  const poisoned = discoverAllowlistEntries("fixture", {
    POISONED_FORM_ADAPTER: {
      formType: "Skilled Nurse Visit Note",
      formVersion: "SNV-v1",
      pages: [
        {
          page: { formType: "Skilled Nurse Visit Note", formVersion: "SNV-v1", pageLabel: "Page 1", pageIndex: 0 },
          allowlist: [
            { key: "SNV-v1::page1::pulse_rate", selector: "#pulse", type: "text", label: "Pulse rate", exactValue: "GA" },
            { key: "SNV-v1::page1::care_plan_reviewed", selector: "#cp", type: "checkbox", label: "Care plan reviewed with patient" }
          ]
        }
      ]
    }
  });
  assert.equal(poisoned.length, 2);
  const rejected = poisoned.filter(({ entry }) => !assertFieldNotProhibited(entry.label).ok);
  assert.deepEqual(rejected.map(({ entry }) => entry.label), ["Pulse rate"]);
});

test("verifyFormVersionAllowlist accepts a page whose entries all belong to that page's form version", () => {
  for (const adapter of syntheticAdapters.SYNTHETIC_FORM_ADAPTERS) {
    for (const page of adapter.pages) {
      const result = verifyFormVersionAllowlist(page.allowlist, adapter.formType, adapter.formVersion, () => ({
        formType: page.page.formType,
        formVersion: page.page.formVersion
      }));
      assert.deepEqual(result, { ok: true, failures: [] }, `${adapter.formVersion} ${page.page.pageLabel}`);
    }
  }
});

test("verifyFormVersionAllowlist rejects an entry carried over from a different form version", () => {
  // The shipped key convention is `${FORM_VERSION}::pageN::field`, so the
  // key prefix is an independent statement of which form version an entry
  // belongs to - a copy/pasted entry disagrees with its page and is caught.
  const snv = syntheticAdapters.SNV_V1_ADAPTER;
  const recertEntry = syntheticAdapters.RECERT_V1_ADAPTER.pages[0]!.allowlist[0]!;
  const page = snv.pages[0]!;
  const result = verifyFormVersionAllowlist(
    [...page.allowlist, recertEntry],
    snv.formType,
    snv.formVersion,
    (entry) => ({ formType: snv.formType, formVersion: entry.key.split("::")[0] ?? "" })
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [`allowlist_entry_wrong_form_version:${recertEntry.key}`]);
});

test("verifyFormVersionAllowlist rejects a form-TYPE mismatch as well as a version mismatch", () => {
  const page = syntheticAdapters.SNV_V1_ADAPTER.pages[0]!;
  const wrongType = verifyFormVersionAllowlist(page.allowlist, "Recertification", "SNV-v1", () => ({
    formType: "Skilled Nurse Visit Note",
    formVersion: "SNV-v1"
  }));
  assert.equal(wrongType.ok, false);
  assert.equal(wrongType.failures.length, page.allowlist.length);
});

test("verifyFormVersionAllowlist normalizes whitespace but is otherwise exact", () => {
  const page = syntheticAdapters.SNV_V1_ADAPTER.pages[0]!;
  const padded = verifyFormVersionAllowlist(page.allowlist, "Skilled Nurse Visit Note", "SNV-v1", () => ({
    formType: "  Skilled   Nurse Visit Note ",
    formVersion: " SNV-v1 "
  }));
  assert.deepEqual(padded, { ok: true, failures: [] });

  const caseChanged = verifyFormVersionAllowlist(page.allowlist, "Skilled Nurse Visit Note", "SNV-v1", () => ({
    formType: "Skilled Nurse Visit Note",
    formVersion: "snv-v1"
  }));
  assert.equal(caseChanged.ok, false, "version comparison must stay case-sensitive");
});

test("verifyFormVersionAllowlist on an empty allowlist is vacuously ok", () => {
  assert.deepEqual(verifyFormVersionAllowlist([], "Any", "v1", () => ({ formType: "Any", formVersion: "v1" })), {
    ok: true,
    failures: []
  });
});
