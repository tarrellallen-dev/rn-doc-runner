import type { DocumentFixture, FieldControlFixture, FormPageFixture, PatientFixture } from "./fixtures.js";
import type { DocumentRuntimeState } from "./state.js";
import { findPatient, DOCUMENTS } from "./fixtures.js";

export function sanitizeId(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title} — RN DOC Runner Synthetic EHR</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 0; background: #f4f5f7; color: #1a1a1a; }
  header.topbar { background: #173d35; color: #fff; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; }
  header.topbar a { color: #fff; text-decoration: none; margin-right: 16px; }
  main { padding: 20px; max-width: 960px; margin: 0 auto; }
  table { width: 100%; border-collapse: collapse; background: #fff; }
  th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; font-size: 14px; }
  th { background: #eef1f0; }
  .episode-folder { background: #fff; border: 1px solid #ccc; border-radius: 6px; padding: 12px; margin-bottom: 12px; }
  .episode-folder > summary { color: #6b6b6b; font-weight: 600; cursor: pointer; }
  .identity-header { background: #fff; border: 1px solid #ccc; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 20px; font-size: 14px; }
  .identity-header b { display: block; font-size: 11px; color: #6b6b6b; text-transform: uppercase; }
  fieldset { border: 1px solid #ddd; border-radius: 6px; margin-bottom: 14px; background: #fff; }
  .prohibited { background: #fff5f5; }
  .prohibited label::after { content: " (prohibited — never automate)"; color: #9f1239; font-size: 11px; }
  .redlink { color: #b91c1c; font-weight: 600; text-decoration: underline; cursor: pointer; }
  dialog { border-radius: 8px; border: 1px solid #999; min-width: 360px; }
  .status-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .status-badge.complete { background: #dcfce7; color: #166534; }
  .status-badge.incomplete { background: #fef3c7; color: #92400e; }
  button { cursor: pointer; padding: 6px 14px; border-radius: 6px; border: 1px solid #999; background: #fff; }
  button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
  button.finalize { background: #7f1d1d; color: #fff; border-color: #7f1d1d; }
  .banner { padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; font-size: 14px; }
  .banner.success { background: #dcfce7; color: #166534; }
  .banner.error { background: #fee2e2; color: #991b1b; }
</style>
</head>
<body>
<header class="topbar">
  <div><strong>Synthetic EHR</strong> — local test fixture, no live records</div>
  <nav><a href="/">Agent Main Menu</a><a href="/pending">Pending</a></nav>
</header>
<main>${body}</main>
</body>
</html>`;
}

export function renderMenu(): string {
  const patientLinks = DOCUMENTS
    .filter((d) => d.status === "Pending")
    .map((d) => d.patientId)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .map((patientId) => {
      const patient = findPatient(patientId);
      if (!patient) return "";
      return `<li><a href="/patients/${patient.id}/chart">${patient.name} — ${patient.mr}</a></li>`;
    })
    .join("");
  return layout(
    "Agent Main Menu",
    `<h1>Agent Main Menu</h1>
     <p><a href="/pending">Open Pending worklist</a></p>
     <h2>Patient Search</h2>
     <ul>${patientLinks}</ul>`
  );
}

export function renderPending(): string {
  const rows = DOCUMENTS.filter((d) => d.status === "Pending")
    .map((d) => {
      const patient = findPatient(d.patientId);
      return `<tr data-document-id="${d.id}" data-patient="${patient?.name}" data-mr="${patient?.mr}" data-form="${d.formType}" data-date="${d.date}" data-user="${d.author}">
        <td>${patient?.name}</td><td>${patient?.mr}</td><td>${d.formType}</td><td>${d.date}</td><td>${d.author}</td>
        <td><a href="/documents/${d.id}?page=0" data-open-document>Open</a></td>
      </tr>`;
    })
    .join("");
  return layout(
    "Pending",
    `<h1>Pending Worklist</h1>
     <table id="rn-pending-table">
       <thead><tr><th>Patient</th><th>MR</th><th>Form</th><th>Date</th><th>User</th><th></th></tr></thead>
       <tbody>${rows}</tbody>
     </table>`
  );
}

export function renderChart(patient: PatientFixture): string {
  const episodes = patient.episodes
    .map((ep) => {
      const rows = ep.documentIds
        .map((docId) => DOCUMENTS.find((d) => d.id === docId))
        .filter((d): d is DocumentFixture => !!d)
        .map(
          (d) =>
            `<tr data-document-id="${d.id}" data-form="${d.formType}" data-date="${d.date}" data-user="${d.author}" data-status="${d.status}">
              <td>${d.formType}</td><td>${d.date}</td><td>${d.author}</td><td>${d.status}</td>
              <td><a href="/documents/${d.id}?page=0&mode=source" data-open-document>Open</a></td>
            </tr>`
        )
        .join("");
      return `<details class="episode-folder" data-episode-id="${ep.id}">
        <summary>${ep.label}</summary>
        <table><thead><tr><th>Form</th><th>Date</th><th>Author</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5"><em>No documents in this episode</em></td></tr>'}</tbody></table>
      </details>`;
    })
    .join("");
  return layout(
    `${patient.name} — Patient Chart`,
    `<h1>Patient Chart</h1>
     <div class="identity-header">
       <div><b>Patient</b><span id="rn-chart-patient">${patient.name}</span></div>
       <div><b>MR</b><span id="rn-chart-mr">${patient.mr}</span></div>
     </div>
     <h2>Episodes (reverse chronological)</h2>
     ${episodes}`
  );
}

function renderControl(control: FieldControlFixture, state: DocumentRuntimeState): string {
  const domId = `ctrl-${sanitizeId(control.key)}`;
  const current = state.controls[control.key] ?? {};
  const wrapClass = control.prohibited ? "prohibited" : "";
  if (control.type === "checkbox") {
    return `<div class="${wrapClass}"><label><input type="checkbox" id="${domId}" name="${control.key}" value="true"
      data-rn-key="${control.key}" data-rn-type="checkbox" ${current.checked ? "checked" : ""}> ${control.label}</label></div>`;
  }
  if (control.type === "radio") {
    return `<div class="${wrapClass}"><label><input type="radio" id="${domId}" name="${control.group}" value="${control.key}"
      data-rn-key="${control.key}" data-rn-type="radio" data-rn-group="${control.group}" ${current.checked ? "checked" : ""}> ${control.label}</label></div>`;
  }
  if (control.type === "select") {
    const options = (control.options ?? [])
      .map((opt) => `<option value="${opt}" ${current.value === opt ? "selected" : ""}>${opt || "Choose"}</option>`)
      .join("");
    return `<div class="${wrapClass}"><label>${control.label}<br/><select id="${domId}" name="${control.key}"
      data-rn-key="${control.key}" data-rn-type="select">${options}</select></label></div>`;
  }
  // text
  return `<div class="${wrapClass}"><label>${control.label}<br/><input type="text" id="${domId}" name="${control.key}"
    value="${current.value ?? ""}" data-rn-key="${control.key}" data-rn-type="text"></label></div>`;
}

function renderRedLinkSections(page: FormPageFixture, documentId: string, state: DocumentRuntimeState): string {
  if (!page.redLinkSections?.length) return "";
  return page.redLinkSections
    .map((section) => {
      const status = state.redLinkSectionStatus[section.id] ?? "incomplete";
      const visibleRows = section.rows.filter((r) => !r.hiddenInCollapsedGroup);
      const collapsedRows = section.rows.filter((r) => r.hiddenInCollapsedGroup);
      const rowHtml = (rows: typeof section.rows) =>
        rows
          .map(
            (row) =>
              `<label style="display:block"><input type="checkbox" id="redlink-${section.id}-row-${row.id}" class="redlink-row" data-row-id="${row.id}"> ${row.label}</label>`
          )
          .join("");
      const collapsedHtml = collapsedRows.length
        ? `<details id="redlink-${section.id}-collapsed-group"><summary>More diagnoses (expand to select)</summary>${rowHtml(collapsedRows)}</details>`
        : "";
      return `
      <p><a class="redlink" id="redlink-${section.id}-open" data-section-id="${section.id}">${section.linkLabel}</a>
      &nbsp;<span id="redlink-${section.id}-status" class="status-badge ${status}">${status}</span></p>
      <input type="hidden" name="redlink_${section.id}_status" id="redlink-${section.id}-status-field" value="${status}">
      <dialog id="redlink-${section.id}-modal">
        <h3>${section.modalTitle}</h3>
        <label><input type="checkbox" id="redlink-${section.id}-select-all"> Select all</label>
        ${rowHtml(visibleRows)}
        ${collapsedHtml}
        <p><button type="button" id="redlink-${section.id}-batch-update-dates">Batch Update Dates</button></p>
        <div id="redlink-${section.id}-date-panel" style="display:none">
          <label>Start Effective Date<br/><input type="text" id="redlink-${section.id}-start-effective-date" placeholder="MM/DD/YYYY"></label><br/>
          <label>Discontinued Date (leave unchanged)<br/><input type="text" id="redlink-${section.id}-discontinued-date" value="${section.discontinuedDateSeed}"></label><br/>
          <button type="button" id="redlink-${section.id}-update">Update</button>
        </div>
        <p><button type="button" class="primary" id="redlink-${section.id}-insert">Insert to Form</button>
        <button type="button" id="redlink-${section.id}-close">Close</button></p>
        <p id="redlink-${section.id}-error" style="color:#991b1b"></p>
      </dialog>`;
    })
    .join("\n");
}

const REDLINK_SCRIPT = `
document.querySelectorAll('[id^="redlink-"][id$="-open"]').forEach((link) => {
  link.addEventListener('click', () => {
    const sectionId = link.dataset.sectionId;
    document.getElementById('redlink-' + sectionId + '-modal').showModal();
  });
});
document.querySelectorAll('[id^="redlink-"][id$="-close"]').forEach((btn) => {
  btn.addEventListener('click', () => btn.closest('dialog').close());
});
document.querySelectorAll('[id^="redlink-"][id$="-select-all"]').forEach((cb) => {
  cb.addEventListener('change', () => {
    const dialog = cb.closest('dialog');
    dialog.querySelectorAll('.redlink-row').forEach((row) => { row.checked = cb.checked; });
  });
});
document.querySelectorAll('[id^="redlink-"][id$="-batch-update-dates"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const panelId = btn.id.replace('-batch-update-dates', '-date-panel');
    document.getElementById(panelId).style.display = 'block';
  });
});
document.querySelectorAll('[id^="redlink-"][id$="-insert"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const sectionId = btn.id.replace('redlink-', '').replace('-insert', '');
    const dialog = document.getElementById('redlink-' + sectionId + '-modal');
    const errorEl = document.getElementById('redlink-' + sectionId + '-error');
    const allRows = Array.from(dialog.querySelectorAll('.redlink-row'));
    const collapsedGroup = document.getElementById('redlink-' + sectionId + '-collapsed-group');
    const collapsedExpanded = !collapsedGroup || collapsedGroup.open;
    const allSelected = allRows.every((r) => r.checked);
    const discInput = document.getElementById('redlink-' + sectionId + '-discontinued-date');
    const seed = discInput.defaultValue;
    const discUnchanged = discInput.value === seed;
    const startEffective = document.getElementById('redlink-' + sectionId + '-start-effective-date').value;
    if (!collapsedExpanded) {
      errorEl.textContent = 'A collapsed group contains unreviewed rows. Expand it first.';
      return;
    }
    if (!allSelected) {
      errorEl.textContent = 'Not every applicable row is selected.';
      return;
    }
    if (!discUnchanged) {
      errorEl.textContent = 'Discontinued Date must remain unchanged.';
      return;
    }
    if (!startEffective) {
      errorEl.textContent = 'Start Effective Date is required.';
      return;
    }
    errorEl.textContent = '';
    document.getElementById('redlink-' + sectionId + '-status').textContent = 'complete';
    document.getElementById('redlink-' + sectionId + '-status').className = 'status-badge complete';
    document.getElementById('redlink-' + sectionId + '-status-field').value = 'complete';
    dialog.close();
  });
});
`;

export function renderDocumentPage(
  documentFixture: DocumentFixture,
  state: DocumentRuntimeState,
  pageIndex: number,
  opts: { saveOutcome?: "success" | "validation_error" | "session_expired" | "ambiguous"; mode?: string } = {}
): string {
  const patient = findPatient(documentFixture.patientId);
  const page = documentFixture.pages[pageIndex];
  const driftActive = documentFixture.behaviorFlags?.includes("layout_drift") ?? false;
  const idFor = (base: string) => (driftActive ? `${base}-drift-v2` : base);

  if (opts.saveOutcome === "session_expired") {
    return layout(
      "Session Expired",
      `<h1 id="rn-session-expired">Session Expired</h1><p>Your session has expired. Please log in again to continue.</p>
       <p><a href="/">Return to Agent Main Menu</a></p>`
    );
  }

  if (!page) {
    return layout(
      "Draft Complete",
      `<h1>Draft saved</h1><p id="rn-draft-complete-banner">All pages for this document have been saved as a draft. RN review, signature, and submission remain required.</p>
       <p><a href="/pending">Return to Pending</a></p>`
    );
  }

  const controlsHtml = page.controls.map((c) => renderControl(c, state)).join("\n");
  const redLinkHtml = renderRedLinkSections(page, documentFixture.id, state);
  const banner =
    opts.saveOutcome === "success"
      ? `<div class="banner success" id="rn-save-success">Draft saved successfully.</div>`
      : opts.saveOutcome === "validation_error"
        ? `<div class="banner error" id="rn-save-validation-error">Validation error: required information is missing or a Plan of Care section is incomplete.</div>`
        : opts.saveOutcome === "ambiguous"
          ? `<div class="banner error" id="rn-save-ambiguous">This page may have already been saved. Verify in the record before retrying — do not resubmit automatically.</div>`
          : "";

  return layout(
    `${documentFixture.formType} — ${page.pageLabel}`,
    `${banner}
     <div class="identity-header">
       <div><b>Patient</b><span id="${idFor("rn-identity-patient")}">${patient?.name}</span></div>
       <div><b>MR</b><span id="${idFor("rn-identity-mr")}">${patient?.mr}</span></div>
       <div><b>Form</b><span id="${idFor("rn-identity-form")}">${documentFixture.formType}</span></div>
       <div><b>Date</b><span id="${idFor("rn-identity-date")}">${documentFixture.date}</span></div>
       <div><b>User</b><span id="${idFor("rn-identity-author")}">${documentFixture.author}</span></div>
       <div><b>Page</b><span id="${idFor("rn-identity-page")}">${page.pageLabel}</span></div>
     </div>
     <form method="post" action="/documents/${documentFixture.id}/save?page=${pageIndex}">
       <fieldset><legend>${page.pageLabel}</legend>${controlsHtml}</fieldset>
       ${redLinkHtml ? `<fieldset><legend>Plan of Care sections</legend>${redLinkHtml}</fieldset>` : ""}
       <button type="submit" class="primary" id="rn-save-draft">Save Draft</button>
       <button type="button" class="finalize" id="rn-sign">Sign</button>
       <button type="button" class="finalize" id="rn-submit">Submit</button>
       <button type="button" class="finalize" id="rn-send-to-office">Send to Office</button>
       <button type="button" class="finalize" id="rn-finalize">Finalize</button>
       <!-- Test-only fixture (Phase 2 / Task P2-4): visible text is deliberately bland while the
            accessible name reveals the true finalization action, proving RN DOC Runner checks
            aria-label/aria-labelledby/title independently of visible text, not just the label a
            sighted user happens to see. No real EHR button is known to do this; this exists purely
            so the accessible-name check has something real to catch. -->
       <button type="button" class="finalize" id="rn-mislabeled-finalize" aria-label="Certify and Submit Record">Continue</button>
     </form>
     <script>${REDLINK_SCRIPT}</script>`
  );
}
