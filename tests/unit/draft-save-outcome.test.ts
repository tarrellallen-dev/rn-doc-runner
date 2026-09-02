/**
 * Save-outcome classification, exercised without a browser.
 *
 * Every branch here turns on what `saveDraftPage` does when the wait for
 * a configured confirmation indicator ends without one — the least
 * observable path through the one function in this codebase that clicks
 * anything. A fake Page lets us drive the three shapes that path has
 * (timed out in place, timed out after a navigation, context torn down
 * by a navigation that DID confirm) precisely, which a real EHR fixture
 * cannot do on demand.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import { saveDraftPage, type DraftSaveConfig } from "@rn-doc-runner/form-engine";
import { STANDARD_IDENTITY_SELECTORS } from "@rn-doc-runner/adapters-synthetic";

const EXPECTED_IDENTITY = {
  patient: "Rehearsal Alpha",
  mr: "SYN-1001",
  form: "Skilled Nurse Visit Note",
  date: "07/28/2026",
  user: "Nurse, Demo (RN)"
};

const CONFIG: DraftSaveConfig = {
  saveButtonSelector: "#rn-save-draft",
  configuredSaveLabel: "Save Draft",
  successIndicatorSelector: "#rn-save-success",
  validationErrorIndicatorSelector: "#rn-save-validation-error",
  sessionExpiredIndicatorSelector: "#rn-session-expired",
  ambiguousIndicatorSelector: "#rn-save-ambiguous",
  waitTimeoutMs: 50
};

type FakeDom = Record<string, { textContent?: string; attributes?: Record<string, string> }>;

/** The identity header and Save Draft control every precondition check needs to pass. */
function baseDom(): FakeDom {
  return {
    [STANDARD_IDENTITY_SELECTORS.patient]: { textContent: EXPECTED_IDENTITY.patient },
    [STANDARD_IDENTITY_SELECTORS.mr]: { textContent: EXPECTED_IDENTITY.mr },
    [STANDARD_IDENTITY_SELECTORS.form]: { textContent: EXPECTED_IDENTITY.form },
    [STANDARD_IDENTITY_SELECTORS.date]: { textContent: EXPECTED_IDENTITY.date },
    [STANDARD_IDENTITY_SELECTORS.author]: { textContent: EXPECTED_IDENTITY.user },
    [STANDARD_IDENTITY_SELECTORS.page]: { textContent: "Page 1 of 2" },
    "#rn-save-draft": { textContent: "Save Draft" }
  };
}

interface FakePageOptions {
  /** What the click does: where it lands, what the resulting document shows, and whether it tore down the polling context. */
  onClick: (state: { url: string; dom: FakeDom; contextDestroyed: boolean }) => void;
}

function makeFakePage(options: FakePageOptions) {
  const state = { url: "https://ehr.example/documents/doc-a2?page=0", dom: baseDom(), contextDestroyed: false };
  const clicks: string[] = [];

  const asDocument = (dom: FakeDom) => {
    const element = (spec: FakeDom[string]) => ({
      textContent: spec.textContent ?? "",
      getAttribute: (name: string) => spec.attributes?.[name] ?? null
    });
    return {
      querySelector: (selector: string) => (dom[selector] ? element(dom[selector]!) : null),
      querySelectorAll: (selector: string) => (dom[selector] ? [element(dom[selector]!)] : []),
      getElementById: (id: string) => (dom[`#${id}`] ? element(dom[`#${id}`]!) : null)
    };
  };

  // The in-page callbacks are self-contained functions of `document`, so
  // running them against a stub document is a faithful stand-in for
  // Playwright serializing them into a real one.
  const runInPage = <A, R>(pageFunction: (arg: A) => R, arg: A): R => {
    const previous = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = asDocument(state.dom);
    try {
      return pageFunction(arg);
    } finally {
      (globalThis as { document?: unknown }).document = previous;
    }
  };

  const page = {
    url: () => state.url,
    click: async (selector: string) => {
      clicks.push(selector);
      options.onClick(state);
    },
    evaluate: async <A, R>(pageFunction: (arg: A) => R, arg: A) => runInPage(pageFunction, arg),
    waitForFunction: async <A, R>(pageFunction: (arg: A) => R, arg: A) => {
      // Two ways a real wait ends without an answer, both modeled here.
      if (state.contextDestroyed) throw new Error("Execution context was destroyed");
      const value = runInPage(pageFunction, arg);
      if (value === null) throw new Error("Timeout 50ms exceeded");
      return { jsonValue: async () => value };
    }
  };

  return { page: page as unknown as Page, clicks, state };
}

function paramsFor(page: Page) {
  return {
    destinationPage: page,
    identitySelectors: STANDARD_IDENTITY_SELECTORS,
    expectedIdentity: EXPECTED_IDENTITY,
    plan: { proposals: [], unresolved: [] },
    appliedVerification: { ok: true, failures: [] },
    config: CONFIG,
    queueEntryId: "queue-a2",
    pageIndex: 0,
    formVersion: "SNV-v1",
    priorSuccessfulKeys: new Set<string>()
  };
}

test("a click that navigates without ever showing a configured indicator is AMBIGUOUS, never SAVED", async () => {
  // An error page, a session-timeout redirect and an interstitial all look
  // exactly like this. Treating the bare URL change as success reported a
  // save that may never have happened.
  const { page, clicks } = makeFakePage({
    onClick: (state) => {
      state.url = "https://ehr.example/error?code=500";
    }
  });

  const result = await saveDraftPage(paramsFor(page));

  assert.equal(result.outcome, "AMBIGUOUS");
  assert.deepEqual(result.failures, ["save_confirmation_indicator_absent_after_navigation"]);
  assert.deepEqual(clicks, ["#rn-save-draft"], "exactly one click, no retry");
});

test("a click that changes nothing at all stays distinguishable from one that navigated", async () => {
  const { page } = makeFakePage({ onClick: () => undefined });

  const result = await saveDraftPage(paramsFor(page));

  assert.equal(result.outcome, "AMBIGUOUS");
  assert.deepEqual(
    result.failures,
    ["save_confirmation_indicator_absent_no_navigation"],
    "triage must be able to tell 'nothing happened' from 'something unconfirmable happened'"
  );
});

test("an auto-advancing form that renders its confirmation on the page it advances TO still reports SAVED", async () => {
  // Playwright can tear the polling context down mid-navigation, so the
  // indicators are re-read once against the settled document before any
  // fail-closed classification is reached.
  const { page } = makeFakePage({
    onClick: (state) => {
      state.url = "https://ehr.example/documents/doc-a2?page=1&savedPrev=1";
      state.dom["#rn-save-success"] = { textContent: "Draft saved successfully." };
      state.contextDestroyed = true;
    }
  });

  const result = await saveDraftPage(paramsFor(page));

  assert.equal(result.outcome, "SAVED");
  assert.deepEqual(result.failures, []);
});

test("a session-expired banner after a navigation is reported as SESSION_EXPIRED, not as an unconfirmed save", async () => {
  const { page } = makeFakePage({
    onClick: (state) => {
      state.url = "https://ehr.example/login";
      state.dom["#rn-session-expired"] = { textContent: "Session Expired" };
      state.contextDestroyed = true;
    }
  });

  const result = await saveDraftPage(paramsFor(page));

  assert.equal(result.outcome, "SESSION_EXPIRED");
});

test("a key already known to have been attempted is blocked before the button is ever clicked", async () => {
  const { page, clicks } = makeFakePage({
    onClick: () => assert.fail("the duplicate-save guard must return before any click")
  });

  const params = paramsFor(page);
  const result = await saveDraftPage({
    ...params,
    priorSuccessfulKeys: new Set(["queue-a2::page-0::SNV-v1"])
  });

  assert.equal(result.outcome, "BLOCKED");
  assert.deepEqual(result.failures, ["duplicate_save_attempt_blocked"]);
  assert.deepEqual(clicks, []);
});
