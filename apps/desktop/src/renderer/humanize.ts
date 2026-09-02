/**
 * Plain-English translations of internal error/reason codes (Phase 2 /
 * Task P2-7: "avoid developer terminology in the normal UI; put
 * technical diagnostics in a separate expandable section"). Every code
 * this app can surface to the RN should have an entry here; anything
 * missing falls back to a generic message, with the raw code still
 * available in a collapsible technical-details element rather than
 * dropped.
 */
const MESSAGES: Record<string, string> = {
  ocr_helper_not_built: "The on-device text reader isn't set up yet. Run setup and try again.",
  image_load_failed: "That photo couldn't be opened. Try re-taking or re-exporting it.",
  pdf_encrypted: "That PDF is password-protected and can't be opened.",
  pdf_load_failed: "That PDF couldn't be opened — it may be damaged.",
  pdf_not_found: "That file couldn't be found.",
  pdf_no_pages: "That PDF has no pages to read.",
  pdf_page_out_of_range: "That page doesn't exist in this document.",
  render_pdf_page_failed: "Couldn't create a preview of that page.",
  convert_failed: "Couldn't prepare that photo for preview.",
  source_file_not_found: "The original file couldn't be found.",
  preview_failed: "Couldn't load a preview.",
  duplicate_of_another_row: "This looks like a duplicate of another row above.",
  patient_not_found_in_directory: "Patient not found — check the spelling of the name.",
  unnormalizable_date: "The date couldn't be read — check the Form Date field.",
  form_category_not_identified: "Form type wasn't identified — choose one from the list.",
  queue_entry_not_found: "That item is no longer available to open.",
  pending_row_not_found: "Couldn't find that document in the record system.",
  pending_row_ambiguous: "Found more than one matching document — open it directly in the record system instead.",
  batch_already_running: "A batch is already running.",
  no_persisted_batch: "There's nothing to resume."
};

/** Short, RN-facing plain-English text for a known internal code; a generic fallback otherwise. */
export function humanize(code: string): string {
  return MESSAGES[code] ?? "Something didn't work as expected.";
}

/** True when a plain-English translation exists — used to decide whether showing the raw code adds anything beyond the technical-details section. */
export function hasHumanTranslation(code: string): boolean {
  return code in MESSAGES;
}
