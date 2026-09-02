import express from "express";
import { DOCUMENTS, findDocument, findPatient } from "./fixtures.js";
import { getDocumentState, resetState } from "./state.js";
import { renderMenu, renderPending, renderChart, renderDocumentPage } from "./render.js";

export function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.get("/", (_req, res) => {
    res.send(renderMenu());
  });

  app.get("/pending", (_req, res) => {
    res.send(renderPending());
  });

  app.get("/patients/:patientId/chart", (req, res) => {
    const patient = findPatient(req.params.patientId);
    if (!patient) return res.status(404).send("Patient not found");
    res.send(renderChart(patient));
  });

  app.get("/documents/:id", (req, res) => {
    const documentFixture = findDocument(req.params.id);
    const state = getDocumentState(req.params.id);
    if (!documentFixture || !state) return res.status(404).send("Document not found");
    const pageIndex = Number(req.query.page ?? 0);
    if (state.sessionExpired) {
      res.send(renderDocumentPage(documentFixture, state, pageIndex, { saveOutcome: "session_expired" }));
      return;
    }
    // The save handler redirects an auto-advancing multi-page form here with
    // `savedPrev=1`; honor it by rendering the same success indicator a save
    // renders in place. Without this the fixture confirms a save only on the
    // final page, and an automation driving it has nothing but the URL change
    // to go on — which is precisely what a save adapter must never treat as
    // confirmation (see form-engine's draft-save.ts, step 10).
    const savedPrev = req.query.savedPrev === "1";
    res.send(renderDocumentPage(documentFixture, state, pageIndex, { mode: String(req.query.mode ?? ""), saveOutcome: savedPrev ? "success" : undefined }));
  });

  app.post("/documents/:id/save", (req, res) => {
    const documentFixture = findDocument(req.params.id);
    const state = getDocumentState(req.params.id);
    if (!documentFixture || !state) return res.status(404).send("Document not found");
    const pageIndex = Number(req.query.page ?? 0);
    const page = documentFixture.pages[pageIndex];
    if (!page) return res.status(400).send("Invalid page");

    if (documentFixture.behaviorFlags?.includes("force_session_expired")) {
      state.sessionExpired = true;
      res.send(renderDocumentPage(documentFixture, state, pageIndex, { saveOutcome: "session_expired" }));
      return;
    }

    if (state.savedPages.has(pageIndex)) {
      res.send(renderDocumentPage(documentFixture, state, pageIndex, { saveOutcome: "ambiguous" }));
      return;
    }

    if (documentFixture.behaviorFlags?.includes("force_validation_error")) {
      res.send(renderDocumentPage(documentFixture, state, pageIndex, { saveOutcome: "validation_error" }));
      return;
    }

    const redLinkSections = page.redLinkSections ?? [];
    const incompleteSection = redLinkSections.find(
      (section) => (req.body[`redlink_${section.id}_status`] ?? state.redLinkSectionStatus[section.id]) !== "complete"
    );
    if (incompleteSection) {
      res.send(renderDocumentPage(documentFixture, state, pageIndex, { saveOutcome: "validation_error" }));
      return;
    }
    for (const section of redLinkSections) {
      state.redLinkSectionStatus[section.id] = "complete";
    }

    // Apply submitted control values for this page only.
    const radioGroupsHandledFalse = new Set<string>();
    for (const control of page.controls) {
      if (control.type === "checkbox") {
        state.controls[control.key] = { checked: req.body[control.key] === "true" };
      } else if (control.type === "radio") {
        const submittedKey = control.group ? req.body[control.group] : undefined;
        state.controls[control.key] = { checked: submittedKey === control.key };
        if (control.group) radioGroupsHandledFalse.add(control.group);
      } else {
        state.controls[control.key] = { value: req.body[control.key] ?? "" };
      }
    }

    state.saveCount += 1;
    state.savedPages.add(pageIndex);
    const idempotencyKey = String(req.body._idempotencyKey ?? `${documentFixture.id}::page-${pageIndex}`);
    state.successfulSaveIdempotencyKeys.add(idempotencyKey);

    const nextPageIndex = pageIndex + 1;
    if (documentFixture.pages[nextPageIndex]) {
      res.redirect(303, `/documents/${documentFixture.id}?page=${nextPageIndex}&savedPrev=1`);
      return;
    }
    res.send(renderDocumentPage(documentFixture, state, pageIndex, { saveOutcome: "success" }));
  });

  // --- Debug/test-only endpoints. Never present in a real EHR; used only by our own automated tests. ---
  app.post("/debug/reset", (_req, res) => {
    resetState();
    res.json({ ok: true });
  });

  app.get("/debug/state/:id", (req, res) => {
    const state = getDocumentState(req.params.id);
    if (!state) return res.status(404).json({ ok: false });
    res.json({
      ok: true,
      controls: state.controls,
      redLinkSectionStatus: state.redLinkSectionStatus,
      saveCount: state.saveCount,
      savedPages: Array.from(state.savedPages)
    });
  });

  app.get("/debug/documents", (_req, res) => {
    res.json(DOCUMENTS.map((d) => ({ id: d.id, patientId: d.patientId, formType: d.formType, date: d.date, status: d.status })));
  });

  return app;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.SYNTHETIC_EHR_PORT ?? 4173);
  createApp().listen(port, () => {
    console.log(`Synthetic EHR listening on http://localhost:${port}`);
  });
}
