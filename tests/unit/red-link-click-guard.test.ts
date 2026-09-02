/**
 * The red-link adapter's click guard and its waits, exercised without a
 * browser.
 *
 * `completeRedLinkSection` activates five caller-configured controls per
 * section — five times the click surface of `saveDraftPage` — so the
 * cases that matter are the ones a real EHR fixture cannot produce on
 * demand: a configuration that points one of those selectors at a
 * finalization control, a control whose visible text is bland while its
 * accessible name is not, and a form that repaints a tick later than the
 * assertion that reads it. A fake Page drives all three precisely.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import { completeRedLinkSection, type RedLinkSectionConfig } from "@rn-doc-runner/form-engine";

const VERIFIED_VISIT_DATE = "07/14/2026";

const SECTION: RedLinkSectionConfig = {
  sectionId: "orders",
  openLinkSelector: "#redlink-orders-open",
  openLinkLabel: "Orders",
  modalSelector: "#redlink-orders-modal",
  selectAllSelector: "#redlink-orders-select-all",
  selectAllLabel: "",
  rowSelector: "#redlink-orders-modal .redlink-row",
  batchUpdateDatesButtonSelector: "#redlink-orders-batch-update-dates",
  batchUpdateDatesButtonLabel: "Batch Update Dates",
  startEffectiveDateInputSelector: "#redlink-orders-start-effective-date",
  discontinuedDateInputSelector: "#redlink-orders-discontinued-date",
  updateButtonSelector: "#redlink-orders-update",
  updateButtonLabel: "Update",
  insertButtonSelector: "#redlink-orders-insert",
  insertButtonLabel: "Insert to Form",
  statusFieldSelector: "#redlink-orders-status-field",
  errorSelector: "#redlink-orders-error",
  waitTimeoutMs: 200
};

interface FakeElement {
  textContent?: string;
  attributes?: Record<string, string>;
  value?: string;
  checked?: boolean;
  open?: boolean;
  /** false models an element that is in the DOM but not rendered (the collapsed date panel). */
  rendered?: boolean;
}

type FakeDom = Record<string, FakeElement[]>;

/** The DOM of a Plan of Care page whose Orders red-link section is untouched, plus the page's real finalization controls. */
function baseDom(): FakeDom {
  return {
    "#redlink-orders-open": [{ textContent: "Orders" }],
    "#redlink-orders-modal": [{ open: false }],
    "#redlink-orders-select-all": [{ textContent: "", checked: false }],
    "#redlink-orders-modal .redlink-row": [{ checked: false }, { checked: false }],
    "#redlink-orders-batch-update-dates": [{ textContent: "Batch Update Dates" }],
    "#redlink-orders-start-effective-date": [{ textContent: "", value: "", rendered: false }],
    "#redlink-orders-discontinued-date": [{ textContent: "", value: "12/31/2099" }],
    "#redlink-orders-update": [{ textContent: "Update" }],
    "#redlink-orders-insert": [{ textContent: "Insert to Form" }],
    "#redlink-orders-status-field": [{ value: "incomplete" }],
    "#redlink-orders-error": [{ textContent: "" }],
    // The same finalization controls the synthetic EHR renders on every document page.
    "#rn-sign": [{ textContent: "Sign" }],
    "#rn-mislabeled-finalize": [{ textContent: "Continue", attributes: { "aria-label": "Certify and Submit Record" } }],
    "#rn-labelledby-finalize": [{ textContent: "Continue", attributes: { "aria-labelledby": "rn-hidden-finalize-heading" } }],
    "#rn-hidden-finalize-heading": [{ textContent: "Sign and submit this note" }],
    "#rn-titled-finalize": [{ textContent: "Continue", attributes: { title: "Finalize document" } }]
  };
}

interface FakePageOptions {
  dom?: FakeDom;
  /** What the EHR does when Insert to Form is clicked. Defaults to the well-behaved section: status complete, modal closed. */
  onInsert?: (dom: FakeDom) => void;
  /** How long the EHR takes to repaint after any click, in ms. Zero models the synthetic EHR's synchronous mutations. */
  repaintDelayMs?: number;
}

function makeFakePage(options: FakePageOptions = {}) {
  const dom = options.dom ?? baseDom();
  const clicks: string[] = [];
  const first = (selector: string): FakeElement | undefined => dom[selector]?.[0];

  const view = (el: FakeElement) => ({
    get textContent() {
      return el.textContent ?? "";
    },
    get value() {
      return el.value;
    },
    get checked() {
      return el.checked;
    },
    get open() {
      return el.open;
    },
    set open(next: boolean | undefined) {
      el.open = next;
    },
    getAttribute: (name: string) => el.attributes?.[name] ?? null,
    getClientRects: () => (el.rendered === false ? [] : [{}])
  });

  const asDocument = () => ({
    querySelector: (selector: string) => (dom[selector]?.length ? view(dom[selector]![0]!) : null),
    querySelectorAll: (selector: string) => (dom[selector] ?? []).map(view),
    getElementById: (id: string) => (dom[`#${id}`]?.length ? view(dom[`#${id}`]![0]!) : null)
  });

  // The in-page callbacks are self-contained functions of `document`, so
  // running them against a stub document is a faithful stand-in for
  // Playwright serializing them into a real one.
  const runInPage = <A, R>(pageFunction: (arg: A) => R, arg: A): R => {
    const previous = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = asDocument();
    try {
      return pageFunction(arg);
    } finally {
      (globalThis as { document?: unknown }).document = previous;
    }
  };

  /** Applies a DOM mutation after the configured repaint delay — the thing a synchronous synthetic EHR never makes anyone handle. */
  const afterRepaint = (mutate: () => void) => {
    const delay = options.repaintDelayMs ?? 0;
    if (delay === 0) {
      mutate();
      return;
    }
    setTimeout(mutate, delay).unref?.();
  };

  const activate = (selector: string) => {
    clicks.push(selector);
    if (selector === SECTION.openLinkSelector) {
      afterRepaint(() => {
        const modal = first(SECTION.modalSelector);
        if (modal) modal.open = true;
      });
    } else if (selector === SECTION.selectAllSelector) {
      afterRepaint(() => {
        for (const row of dom[SECTION.rowSelector] ?? []) row.checked = true;
      });
    } else if (selector === SECTION.batchUpdateDatesButtonSelector) {
      afterRepaint(() => {
        const input = first(SECTION.startEffectiveDateInputSelector);
        if (input) input.rendered = true;
      });
    } else if (selector === SECTION.insertButtonSelector) {
      afterRepaint(() =>
        options.onInsert
          ? options.onInsert(dom)
          : (() => {
              first(SECTION.statusFieldSelector)!.value = "complete";
              first(SECTION.modalSelector)!.open = false;
            })()
      );
    }
  };

  const page = {
    url: () => "https://ehr.example/documents/doc-b2?page=1",
    click: async (selector: string) => activate(selector),
    check: async (selector: string) => {
      const el = first(selector);
      if (el) el.checked = true;
      activate(selector);
    },
    fill: async (selector: string, value: string) => {
      const el = first(selector);
      if (el) el.value = value;
    },
    evaluate: async <A, R>(pageFunction: (arg: A) => R, arg: A) => runInPage(pageFunction, arg),
    waitForFunction: async <A, R>(pageFunction: (arg: A) => R, arg: A, opts?: { timeout?: number }) => {
      const deadline = Date.now() + (opts?.timeout ?? 5000);
      for (;;) {
        const value = runInPage(pageFunction, arg);
        if (value !== null && value !== undefined && value !== false) return { jsonValue: async () => value };
        if (Date.now() >= deadline) throw new Error("Timeout exceeded");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
  };

  return { page: page as unknown as Page, clicks, dom };
}

test("an insert selector pointed at a control labeled 'Sign' is refused, and that control is never clicked", async () => {
  // The failure this whole guard exists for: red-link configuration is
  // caller-supplied, and one wrong selector used to be clicked without any
  // label check at all.
  const { page, clicks, dom } = makeFakePage();

  const result = await completeRedLinkSection(page, { ...SECTION, insertButtonSelector: "#rn-sign" }, VERIFIED_VISIT_DATE);

  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("label_matches_finalization_pattern:insert_button"), result.failures.join(","));
  assert.equal(clicks.includes("#rn-sign"), false, "the Sign control must never be clicked");
  assert.equal(dom["#redlink-orders-status-field"]![0]!.value, "incomplete");
});

test("an insert control whose visible text is bland ('Continue') but whose aria-label is a finalization action is still refused", async () => {
  // Text and accessible name can disagree; a screen reader announces the
  // accessible name INSTEAD of the text, so the text alone proves nothing.
  const { page, clicks } = makeFakePage();

  const result = await completeRedLinkSection(
    page,
    { ...SECTION, insertButtonSelector: "#rn-mislabeled-finalize", insertButtonLabel: "Continue" },
    VERIFIED_VISIT_DATE
  );

  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("aria_label_matches_finalization_pattern:insert_button"), result.failures.join(","));
  assert.equal(clicks.includes("#rn-mislabeled-finalize"), false, "an accessible-name-only finalization control must never be clicked");
});

test("aria-labelledby and title are checked independently of both text and aria-label", async () => {
  for (const [selector, expectedFailure] of [
    ["#rn-labelledby-finalize", "aria_labelledby_matches_finalization_pattern:insert_button"],
    ["#rn-titled-finalize", "title_matches_finalization_pattern:insert_button"]
  ] as const) {
    const { page, clicks } = makeFakePage();
    const result = await completeRedLinkSection(page, { ...SECTION, insertButtonSelector: selector, insertButtonLabel: "Continue" }, VERIFIED_VISIT_DATE);
    assert.equal(result.ok, false);
    assert.ok(result.failures.includes(expectedFailure), `${selector}: ${result.failures.join(",")}`);
    assert.equal(clicks.includes(selector), false);
  }
});

test("a control whose label is merely the wrong one (not a finalization label) is also refused", async () => {
  const { page, clicks } = makeFakePage();

  const result = await completeRedLinkSection(page, { ...SECTION, batchUpdateDatesButtonLabel: "Batch Update Visits" }, VERIFIED_VISIT_DATE);

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, ["label_does_not_match_expected_control:batch_update_dates_button"]);
  assert.equal(clicks.includes(SECTION.batchUpdateDatesButtonSelector), false);
});

test("a selector matching more than one control is refused rather than resolved to the first match", async () => {
  const dom = baseDom();
  dom["#redlink-orders-insert"] = [{ textContent: "Insert to Form" }, { textContent: "Insert to Form" }];
  const { page, clicks } = makeFakePage({ dom });

  const result = await completeRedLinkSection(page, SECTION, VERIFIED_VISIT_DATE);

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, ["selector_multiple_matches:insert_button"]);
  assert.equal(clicks.includes(SECTION.insertButtonSelector), false);
});

test("a correctly configured section still completes — the guard blocks finalization controls, not the workflow", async () => {
  const { page, clicks, dom } = makeFakePage();

  const result = await completeRedLinkSection(page, SECTION, VERIFIED_VISIT_DATE);

  assert.deepEqual(result, { sectionId: "orders", ok: true, failures: [] });
  assert.deepEqual(clicks, [
    SECTION.openLinkSelector,
    SECTION.selectAllSelector,
    SECTION.batchUpdateDatesButtonSelector,
    SECTION.updateButtonSelector,
    SECTION.insertButtonSelector
  ]);
  assert.equal(dom["#redlink-orders-discontinued-date"]![0]!.value, "12/31/2099", "Discontinued Date is never written");
});

test("an EHR that repaints a tick after each click still completes, instead of failing closed into NEEDS_REVIEW", async () => {
  // Every assertion used to read the DOM in the same tick as the action that
  // was supposed to change it. That holds only for the synthetic EHR, which
  // mutates synchronously; against a real one each such read is a flake, and
  // every flake becomes a nurse-facing exception.
  const { page } = makeFakePage({ repaintDelayMs: 25 });

  const result = await completeRedLinkSection(page, SECTION, VERIFIED_VISIT_DATE);

  assert.deepEqual(result, { sectionId: "orders", ok: true, failures: [] });
});

test("a modal removed from the DOM on close is reported as unverifiable, never as a changed Discontinued Date", async () => {
  // `discontinued_date_was_changed` is the loudest string this module emits.
  // A benign DOM removal reads as `null`, which is never equal to the value
  // read before the insertion — and used to be reported as an unauthorized
  // date edit.
  const { page } = makeFakePage({
    onInsert: (dom) => {
      dom["#redlink-orders-status-field"]![0]!.value = "complete";
      delete dom["#redlink-orders-modal"];
      delete dom["#redlink-orders-discontinued-date"];
    }
  });

  const result = await completeRedLinkSection(page, SECTION, VERIFIED_VISIT_DATE);

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, ["discontinued_date_unverifiable_modal_removed"]);
});

test("a Discontinued Date that actually changed is still reported as changed", async () => {
  const { page } = makeFakePage({
    onInsert: (dom) => {
      dom["#redlink-orders-status-field"]![0]!.value = "complete";
      dom["#redlink-orders-modal"]![0]!.open = false;
      dom["#redlink-orders-discontinued-date"]![0]!.value = "01/01/2027";
    }
  });

  const result = await completeRedLinkSection(page, SECTION, VERIFIED_VISIT_DATE);

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, ["discontinued_date_was_changed"]);
});

test("the EHR's own validation error is carried through as the section's failure reason", async () => {
  const { page } = makeFakePage({
    onInsert: (dom) => {
      dom["#redlink-orders-error"]![0]!.textContent = "Not every applicable row is selected.";
    }
  });

  const result = await completeRedLinkSection(page, SECTION, VERIFIED_VISIT_DATE);

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, ["red_link_incomplete:Not every applicable row is selected."]);
});
