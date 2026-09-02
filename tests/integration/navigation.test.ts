import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { createApp } from "@rn-doc-runner/synthetic-ehr";
import { findExactPendingRow, openHome, matchesExpectedIdentity, findPredecessor } from "@rn-doc-runner/queue-engine";
import { readIdentity } from "@rn-doc-runner/form-engine";
import { STANDARD_IDENTITY_SELECTORS } from "@rn-doc-runner/adapters-synthetic";
import * as rules from "@rn-doc-runner/rules";

const EXPECTED_AUTHOR = "Nurse, Demo (RN)";

let browser: Browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

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

test("Home -> Pending -> exact row -> open -> re-verify identity matches the worklist entry", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      await openHome(page, base);
      assert.match(await page.title(), /Agent Main Menu/);

      const criteria = { patient: "Rehearsal Alpha", mr: "SYN-1001", form: "Skilled Nurse Visit Note", date: "07/28/2026", user: EXPECTED_AUTHOR };
      const found = await findExactPendingRow(page, base, criteria);
      assert.equal(found.ok, true, found.failures.join(","));
      assert.equal(found.documentId, "doc-a2");

      await page.goto(`${base}${found.href}`);
      const identity = await readIdentity(page, STANDARD_IDENTITY_SELECTORS);
      const match = matchesExpectedIdentity(identity, criteria);
      assert.equal(match.ok, true, match.failures.join(","));
    } finally {
      await page.close();
    }
  });
});

test("an ambiguous pending row (two indistinguishable matches) is rejected, not opened", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      const criteria = { patient: "Rehearsal Juliet", mr: "SYN-1010", form: "Skilled Nurse Visit Note", date: "07/19/2026", user: EXPECTED_AUTHOR };
      const found = await findExactPendingRow(page, base, criteria);
      assert.equal(found.ok, false);
      assert.deepEqual(found.failures, ["pending_row_ambiguous"]);
    } finally {
      await page.close();
    }
  });
});

test("a pending row with no match is rejected", async () => {
  await withServer(async (base) => {
    const page = await browser.newPage();
    try {
      const criteria = { patient: "Nobody Real", mr: "SYN-0000", form: "Skilled Nurse Visit Note", date: "01/01/2026", user: EXPECTED_AUTHOR };
      const found = await findExactPendingRow(page, base, criteria);
      assert.equal(found.ok, false);
      assert.deepEqual(found.failures, ["pending_row_not_found"]);
    } finally {
      await page.close();
    }
  });
});

test("predecessor discovery finds the nearest qualifying same-type predecessor for patient 1", async () => {
  await withServer(async (base) => {
    const chartPage = await browser.newPage();
    try {
      const destinationDateMs = rules.parseUsDate("07/28/2026")!;
      const result = await findPredecessor(chartPage, base, "pat-1", {
        formType: "Skilled Nurse Visit Note",
        expectedAuthor: EXPECTED_AUTHOR,
        destinationDateMs
      });
      assert.equal(result.ok, true, result.failures.join(","));
      assert.equal(result.documentId, "doc-a1");
    } finally {
      await chartPage.close();
    }
  });
});

test("predecessor discovery reaches an older episode when the nearer one has no qualifying documents (patient 5)", async () => {
  await withServer(async (base) => {
    const chartPage = await browser.newPage();
    try {
      const destinationDateMs = rules.parseUsDate("07/25/2026")!;
      const result = await findPredecessor(chartPage, base, "pat-5", {
        formType: "Skilled Nurse Visit Note",
        expectedAuthor: EXPECTED_AUTHOR,
        destinationDateMs
      });
      assert.equal(result.ok, true, result.failures.join(","));
      assert.equal(result.documentId, "doc-e1");
    } finally {
      await chartPage.close();
    }
  });
});

test("predecessor discovery reports ambiguous chronology for patient 3 (two same-date candidates) instead of guessing", async () => {
  await withServer(async (base) => {
    const chartPage = await browser.newPage();
    try {
      const destinationDateMs = rules.parseUsDate("07/20/2026")!;
      const result = await findPredecessor(chartPage, base, "pat-3", {
        formType: "Skilled Nurse Visit Note",
        expectedAuthor: EXPECTED_AUTHOR,
        destinationDateMs
      });
      assert.equal(result.ok, false);
      assert.deepEqual(result.failures, ["ambiguous_predecessor_chronology"]);
    } finally {
      await chartPage.close();
    }
  });
});

test("predecessor discovery rejects a wrong-author predecessor for patient 4 (no qualifying source exists)", async () => {
  await withServer(async (base) => {
    const chartPage = await browser.newPage();
    try {
      const destinationDateMs = rules.parseUsDate("07/22/2026")!;
      const result = await findPredecessor(chartPage, base, "pat-4", {
        formType: "Skilled Nurse Visit Note",
        expectedAuthor: EXPECTED_AUTHOR,
        destinationDateMs
      });
      assert.equal(result.ok, false);
      assert.deepEqual(result.failures, ["no_qualifying_predecessor"]);
    } finally {
      await chartPage.close();
    }
  });
});
