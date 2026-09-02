/**
 * Recert red-link Plan of Care date-update adapter (Task 12,
 * WF_PLAN_OF_CARE_DATE_UPDATES.md). One tested configuration per
 * section — never generalize one red-link adapter to another section
 * without its own configuration. Fails closed on any hidden,
 * inaccessible, unexpected, or partially selected row, and never
 * touches Discontinued Date.
 *
 * Every control this module activates goes through
 * `clickVerifiedControl`, so each of the five configured selectors must
 * declare the label it expects and is refused if what it actually
 * resolves to is a finalization control (sign / submit / send to office
 * / finalize). This module clicks five times per section; the same
 * guarantee `draft-save.ts` makes for its single click therefore has to
 * hold here five times over.
 */
import type { Page } from "playwright";
import * as rules from "@rn-doc-runner/rules";
import { clickVerifiedControl } from "./verified-click.js";

export interface RedLinkSectionConfig {
  sectionId: string;
  openLinkSelector: string;
  /** Exact visible text of the configured red link. Declared per section (sections are named, e.g. "Diagnoses" / "Orders") and verified before the link is clicked. */
  openLinkLabel: string;
  modalSelector: string;
  selectAllSelector: string;
  /** The header Select All is a bare `<input type="checkbox">` whose name lives on a wrapping `<label>`, so its own visible text is "" — the accessible-name finalization checks still run on it. */
  selectAllLabel: string;
  /** Must already be scoped to this section's modal (e.g. "#redlink-diagnoses-modal .redlink-row") — never a bare class selector shared across sections. */
  rowSelector: string;
  collapsedGroupSelector?: string;
  batchUpdateDatesButtonSelector: string;
  batchUpdateDatesButtonLabel: string;
  startEffectiveDateInputSelector: string;
  discontinuedDateInputSelector: string;
  updateButtonSelector: string;
  updateButtonLabel: string;
  insertButtonSelector: string;
  insertButtonLabel: string;
  statusFieldSelector: string;
  errorSelector: string;
  /** How long each post-action DOM transition may take before this section fails closed. */
  waitTimeoutMs?: number;
}

export interface RedLinkSectionResult {
  sectionId: string;
  ok: boolean;
  failures: string[];
}

/**
 * Task 12 steps, per section: open the exact configured red link; verify
 * the expected modal opened; expand any collapsed group; select every
 * applicable row via the header Select All; verify row-selection
 * completeness; click Batch Update Dates; enter the already-verified
 * current Visit Date as Start Effective Date; leave Discontinued Date
 * untouched; click Update, then Insert to Form; verify closure/insertion.
 *
 * Nothing here assumes the EHR mutates the DOM synchronously: every
 * assertion about the effect of an action is a bounded wait for the state
 * it expects, because a plain read one tick after a click reports "it
 * didn't happen" for a form that merely hadn't repainted yet — and every
 * such false negative costs a nurse a NEEDS_REVIEW exception.
 */
export async function completeRedLinkSection(page: Page, config: RedLinkSectionConfig, verifiedVisitDate: string): Promise<RedLinkSectionResult> {
  const fail = (...reasons: string[]): RedLinkSectionResult => ({ sectionId: config.sectionId, ok: false, failures: reasons });
  const timeout = config.waitTimeoutMs ?? 5000;

  /** Bounded wait for an in-page condition, mirroring draft-save.ts's indicator wait. Resolves to the condition's value, or null if it never became truthy. */
  const waitFor = async <A, R>(condition: (arg: A) => R | null, arg: A): Promise<R | null> => {
    try {
      // Cast through `unknown` only to satisfy Playwright's `Unboxed<Arg>`
      // parameter mapping, which cannot be resolved for a generic Arg. The
      // callback is still a self-contained function of `document` and plain
      // serializable data, exactly as Playwright requires.
      const evaluated = condition as unknown as (arg: unknown) => R | null;
      const handle = await page.waitForFunction(evaluated, arg as unknown, { timeout, polling: 100 });
      return (await handle.jsonValue()) as R;
    } catch {
      return null;
    }
  };

  const opened = await clickVerifiedControl(page, config.openLinkSelector, { as: "open_link", expect: config.openLinkLabel });
  if (!opened.ok) return fail(...opened.failures);

  const modalOpen = await waitFor((sel) => ((document.querySelector(sel) as HTMLDialogElement | null)?.open === true ? true : null), config.modalSelector);
  if (!modalOpen) return fail("modal_did_not_open");

  const discontinuedBefore = await page.evaluate((sel) => (document.querySelector(sel) as HTMLInputElement | null)?.value ?? null, config.discontinuedDateInputSelector);
  if (discontinuedBefore === null) return fail("discontinued_date_field_missing");

  if (config.collapsedGroupSelector) {
    // The group may be rendered with the modal's contents rather than with the
    // modal frame, so wait for it instead of reading once: "not there yet" and
    // "not there at all" are the same read but not the same situation.
    const groupExists = await waitFor((sel) => (document.querySelector(sel) !== null ? true : null), config.collapsedGroupSelector);
    if (!groupExists) return fail("expected_collapsed_group_missing");
    await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLDetailsElement | null;
      if (el) el.open = true;
    }, config.collapsedGroupSelector);
  }

  const rowCount = await waitFor((sel) => document.querySelectorAll(sel).length || null, config.rowSelector);
  if (!rowCount) return fail("no_applicable_rows_found");

  const selectedAll = await clickVerifiedControl(page, config.selectAllSelector, { as: "select_all", expect: config.selectAllLabel, action: "check" });
  if (!selectedAll.ok) return fail(...selectedAll.failures);

  const allSelected = await waitFor(
    (sel) => (Array.from(document.querySelectorAll(sel)).every((el) => (el as HTMLInputElement).checked) ? true : null),
    config.rowSelector
  );
  if (!allSelected) return fail("not_every_applicable_row_selected");

  const batchUpdate = await clickVerifiedControl(page, config.batchUpdateDatesButtonSelector, {
    as: "batch_update_dates_button",
    expect: config.batchUpdateDatesButtonLabel
  });
  if (!batchUpdate.ok) return fail(...batchUpdate.failures);

  // The date panel is revealed by the Batch Update Dates click; `fill` would
  // wait for actionability on its own, but a panel that never appears has to
  // be reported as that, not as an anonymous Playwright timeout.
  const datePanelVisible = await waitFor((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    return el !== null && el.getClientRects().length > 0 ? true : null;
  }, config.startEffectiveDateInputSelector);
  if (!datePanelVisible) return fail("batch_update_dates_panel_did_not_open");

  await page.fill(config.startEffectiveDateInputSelector, verifiedVisitDate);
  const startEffectiveValue = await waitFor((sel) => (document.querySelector(sel) as HTMLInputElement | null)?.value || null, config.startEffectiveDateInputSelector);
  if (!startEffectiveValue) return fail("start_effective_date_not_applied");
  // Compared as dates, not as strings: a field that re-formats what was typed
  // (7/14/2026 for 07/14/2026) is still the date we verified, while any other
  // date is a hard stop.
  if (rules.parseUsDate(startEffectiveValue) !== rules.parseUsDate(verifiedVisitDate)) {
    return fail("start_effective_date_mismatch");
  }

  const updated = await clickVerifiedControl(page, config.updateButtonSelector, { as: "update_button", expect: config.updateButtonLabel });
  if (!updated.ok) return fail(...updated.failures);

  // Update commits the panel's dates into the pending row set and exposes
  // nothing of its own to wait on; a not-yet-ready Insert control is covered
  // by Playwright's actionability wait inside the click, and a not-yet-applied
  // date shows up in the terminal wait below as the EHR's own error text.
  const inserted = await clickVerifiedControl(page, config.insertButtonSelector, { as: "insert_button", expect: config.insertButtonLabel });
  if (!inserted.ok) return fail(...inserted.failures);

  // One wait, two terminal states: the section completed and its modal closed,
  // or the EHR's own validation rejected the insertion.
  const settleSelectors = { status: config.statusFieldSelector, modal: config.modalSelector, error: config.errorSelector };
  const readSettledStateInPage = (sel: { status: string; modal: string; error: string }): string | null => {
    const error = document.querySelector(sel.error)?.textContent?.trim() ?? "";
    if (error) return `error:${error}`;
    const status = (document.querySelector(sel.status) as HTMLInputElement | null)?.value ?? null;
    const modal = document.querySelector(sel.modal) as HTMLDialogElement | null;
    if (status === "complete" && (modal === null || modal.open !== true)) return "complete";
    return null;
  };
  const settled = await waitFor(readSettledStateInPage, settleSelectors);
  if (settled !== "complete") {
    // Neither terminal state inside the timeout, or the error branch: re-read
    // once so the reported reason is whatever the page finally showed.
    const finalState = await page.evaluate(readSettledStateInPage, settleSelectors).catch(() => null);
    const errorText = finalState?.startsWith("error:") ? finalState.slice("error:".length) : "";
    return fail(errorText ? `red_link_incomplete:${errorText}` : "red_link_incomplete");
  }

  // Discontinued Date must be exactly what it was before the insertion. Read
  // the modal's presence alongside it: a modal that the EHR removes from the
  // DOM when it closes takes the field with it, and a missing field reads as
  // `null`, which is never equal to the value read before — reporting that as
  // "discontinued_date_was_changed", the loudest string this module emits,
  // turned a benign DOM removal into a suspected unauthorized date edit.
  const after = await page.evaluate(
    (sel) => ({
      value: (document.querySelector(sel.field) as HTMLInputElement | null)?.value ?? null,
      modalPresent: document.querySelector(sel.modal) !== null
    }),
    { field: config.discontinuedDateInputSelector, modal: config.modalSelector }
  );
  if (after.value === null) {
    return fail(after.modalPresent ? "discontinued_date_field_missing_after_insert" : "discontinued_date_unverifiable_modal_removed");
  }
  if (after.value !== discontinuedBefore) return fail("discontinued_date_was_changed");

  return { sectionId: config.sectionId, ok: true, failures: [] };
}

export interface RedLinkPlanResult {
  ok: boolean;
  sections: RedLinkSectionResult[];
}

/**
 * Every applicable configured section must complete before the page may
 * be saved. One failing section fails the whole page — never a partial
 * save of some sections.
 */
export async function completeAllRedLinkSections(page: Page, sections: RedLinkSectionConfig[], verifiedVisitDate: string): Promise<RedLinkPlanResult> {
  const results: RedLinkSectionResult[] = [];
  for (const section of sections) {
    results.push(await completeRedLinkSection(page, section, verifiedVisitDate));
  }
  return { ok: results.every((r) => r.ok), sections: results };
}
