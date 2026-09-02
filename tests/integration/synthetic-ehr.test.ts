import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "@rn-doc-runner/synthetic-ehr";

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("pending worklist lists the exact patient/mr/form/date/user tuple for a pending document", async () => {
  await withServer(async (base) => {
    const html = await (await fetch(`${base}/pending`)).text();
    assert.match(html, /data-patient="Rehearsal Alpha"/);
    assert.match(html, /data-mr="SYN-1001"/);
    assert.match(html, /data-form="Skilled Nurse Visit Note"/);
    assert.match(html, /data-date="07\/28\/2026"/);
    assert.match(html, /data-user="Nurse, Demo \(RN\)"/);
  });
});

test("document page exposes exactly one identity element per field", async () => {
  await withServer(async (base) => {
    const html = await (await fetch(`${base}/documents/doc-a2?page=0`)).text();
    for (const id of ["rn-identity-patient", "rn-identity-mr", "rn-identity-form", "rn-identity-date", "rn-identity-author", "rn-identity-page"]) {
      const matches = html.match(new RegExp(`id="${id}"`, "g")) ?? [];
      assert.equal(matches.length, 1, `expected exactly one #${id}`);
    }
  });
});

test("layout-drift document renders drifted identity ids instead of the standard ones", async () => {
  await withServer(async (base) => {
    const html = await (await fetch(`${base}/documents/doc-g2?page=0`)).text();
    assert.doesNotMatch(html, /id="rn-identity-patient"/);
    assert.match(html, /id="rn-identity-patient-drift-v2"/);
  });
});

test("finalization controls (Sign/Submit/Send to Office/Finalize) render but are never form-submit targets", async () => {
  await withServer(async (base) => {
    const html = await (await fetch(`${base}/documents/doc-a2?page=0`)).text();
    const tagContaining = (id: string) => {
      const match = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`));
      assert.ok(match, `expected a <button> with id="${id}"`);
      return match![0];
    };
    for (const id of ["rn-sign", "rn-submit", "rn-send-to-office", "rn-finalize", "rn-mislabeled-finalize"]) {
      assert.match(tagContaining(id), /type="button"/, `${id} must not be a submit button`);
    }
    assert.match(tagContaining("rn-save-draft"), /type="submit"/);
  });
});

test("a finalization control whose visible text is bland still carries a finalization accessible name (P2-4 fixture)", async () => {
  await withServer(async (base) => {
    const html = await (await fetch(`${base}/documents/doc-a2?page=0`)).text();
    const match = html.match(/<button[^>]*id="rn-mislabeled-finalize"[^>]*>([^<]*)<\/button>/);
    assert.ok(match, "expected the mislabeled-finalize test fixture button");
    assert.equal(match![1], "Continue", "visible text must look bland, not obviously a finalization action");
    assert.match(match![0], /aria-label="Certify and Submit Record"/);
  });
});

test("saving page 0 with valid data auto-advances to page 1, and the final page reports draft complete", async () => {
  await withServer(async (base) => {
    const save1 = await fetch(`${base}/documents/doc-a2/save?page=0`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "SNV-v1::page1::care_plan_reviewed=true",
      redirect: "manual"
    });
    assert.equal(save1.status, 303);
    assert.match(String(save1.headers.get("location")), /page=1/);

    const save2 = await fetch(`${base}/documents/doc-a2/save?page=1`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: ""
    });
    const html2 = await save2.text();
    assert.match(html2, /rn-save-success|Draft saved/);
  });
});

test("resubmitting an already-saved page returns an ambiguous outcome instead of silently re-saving", async () => {
  await withServer(async (base) => {
    await fetch(`${base}/debug/reset`, { method: "POST" });
    await fetch(`${base}/documents/doc-h1/save?page=0`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
      redirect: "manual"
    });
    const secondAttempt = await fetch(`${base}/documents/doc-h1/save?page=0`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: ""
    });
    const html = await secondAttempt.text();
    assert.match(html, /rn-save-ambiguous/);
  });
});

test("force_validation_error documents always fail save with a validation error banner", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/documents/doc-h2/save?page=0`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: ""
    });
    const html = await res.text();
    assert.match(html, /rn-save-validation-error/);
  });
});

test("force_session_expired documents show the session-expired page instead of saving", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/documents/doc-i2/save?page=0`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: ""
    });
    const html = await res.text();
    assert.match(html, /Session Expired/);
    const followUp = await fetch(`${base}/documents/doc-i2?page=0`);
    assert.match(await followUp.text(), /Session Expired/);
  });
});

test("recert page 1 (Plan of Care) is blocked from saving until both red-link sections report complete", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/documents/doc-b2/save?page=1`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "redlink_diagnoses_status=incomplete&redlink_orders_status=incomplete"
    });
    const html = await res.text();
    assert.match(html, /rn-save-validation-error/);
  });
});

test("recert page 1 saves once both red-link sections report complete", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/documents/doc-b2/save?page=1`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "redlink_diagnoses_status=complete&redlink_orders_status=complete"
    });
    const html = await res.text();
    assert.match(html, /Draft saved|rn-save-success/);
  });
});

test("patient chart lists episodes in the fixture's reverse-chronological order with author/date/form visible", async () => {
  await withServer(async (base) => {
    const html = await (await fetch(`${base}/patients/pat-5/chart`)).text();
    const currentIndex = html.indexOf("Episode #1 (current)");
    const oldestIndex = html.indexOf("Episode #3 (oldest)");
    assert.ok(currentIndex >= 0 && oldestIndex >= 0);
    assert.ok(currentIndex < oldestIndex, "current episode must render before older episodes (reverse chronological)");
    assert.match(html, /data-form="Skilled Nurse Visit Note"/);
  });
});
