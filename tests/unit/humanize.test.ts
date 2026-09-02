/**
 * Phase 2 / Task P2-7: "avoid developer terminology in the normal UI" —
 * every internal error/reason code the desktop UI can surface must have
 * a plain-English translation, and unknown codes must still fall back
 * to a friendly generic message rather than leaking the raw code into
 * the main text (the raw code goes in a collapsed technical-details
 * element instead — see apps/desktop/src/renderer/ErrorNote.tsx).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { humanize, hasHumanTranslation } from "@rn-doc-runner/desktop/renderer/humanize";

const CODES_USED_ELSEWHERE_IN_THE_APP = [
  "ocr_helper_not_built",
  "image_load_failed",
  "pdf_encrypted",
  "pdf_load_failed",
  "pdf_not_found",
  "pdf_no_pages",
  "pdf_page_out_of_range",
  "render_pdf_page_failed",
  "convert_failed",
  "source_file_not_found",
  "preview_failed",
  "duplicate_of_another_row",
  "patient_not_found_in_directory",
  "unnormalizable_date",
  "form_category_not_identified",
  "queue_entry_not_found",
  "pending_row_not_found",
  "pending_row_ambiguous",
  "batch_already_running",
  "no_persisted_batch"
];

test("every internal code the app actually produces has a plain-English translation, not a raw snake_case string", () => {
  for (const code of CODES_USED_ELSEWHERE_IN_THE_APP) {
    assert.ok(hasHumanTranslation(code), `missing a human translation for "${code}"`);
    const message = humanize(code);
    assert.notEqual(message, code);
    assert.doesNotMatch(message, /^[a-z0-9]+(_[a-z0-9]+)+$/, `"${message}" for "${code}" still looks like a raw code`);
  }
});

test("an unrecognized code still gets a friendly fallback instead of being shown raw", () => {
  assert.equal(hasHumanTranslation("some_future_code_nobody_mapped_yet"), false);
  assert.equal(humanize("some_future_code_nobody_mapped_yet"), "Something didn't work as expected.");
});
