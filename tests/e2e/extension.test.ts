/**
 * Loads the ACTUAL built extension bundle (extension/dist/*.js +
 * manifest.json) into a real Chromium instance and exercises the
 * content script's message handlers exactly as the popup does — proving
 * the shipped artifact works, not just the source it was built from.
 *
 * Requires `npm run build --workspace=@rn-doc-runner/extension` to have
 * produced extension/dist/*.js, and runs the synthetic EHR on the fixed
 * port 4173 that the Synthetic Development Mode manifest's host
 * permission is scoped to.
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { chromium, type BrowserContext } from "playwright";
import { createApp } from "@rn-doc-runner/synthetic-ehr";
import { SYNTHETIC_SITE_ADAPTER, SNV_V1_ADAPTER } from "@rn-doc-runner/adapters-synthetic";

const EXTENSION_PATH = path.resolve(import.meta.dirname, "../../extension");
const PORT = 4173;
const BASE = `http://localhost:${PORT}`;

async function getExtensionId(context: BrowserContext): Promise<string> {
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 10000 });
  return new URL(sw.url()).host;
}

test("the built extension: content script captures, compares, highlights, and applies through real chrome.runtime messaging", async (t) => {
  if (!fs.existsSync(path.join(EXTENSION_PATH, "dist/content.js"))) {
    t.skip('extension/dist not built — run "npm run build --workspace=@rn-doc-runner/extension"');
    return;
  }

  const server = createApp().listen(PORT);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-doc-runner-ext-"));
  let context: BrowserContext | undefined;

  try {
    await fetch(`${BASE}/debug/reset`, { method: "POST" });

    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`]
    });
    const extensionId = await getExtensionId(context);

    const sourcePage = await context.newPage();
    await sourcePage.goto(`${BASE}/documents/doc-a1?page=0`);
    const destinationPage = await context.newPage();
    await destinationPage.goto(`${BASE}/documents/doc-a2?page=0`);

    const controlPage = await context.newPage();
    await controlPage.goto(`chrome-extension://${extensionId}/popup.html`);

    // Simulate what the desktop app's adapter installer / batch orchestrator writes:
    // the site-level adapter config, plus the CURRENT page's own form-version
    // allowlist (SNV-v1 page 1, matching both doc-a1 and doc-a2 at ?page=0).
    await controlPage.evaluate(
      ({ adapter, allowlist }) =>
        chrome.storage.local.set({ rnDocRunnerActiveAdapter: adapter, rnDocRunnerActiveAllowlist: allowlist }),
      { adapter: SYNTHETIC_SITE_ADAPTER, allowlist: SNV_V1_ADAPTER.pages[0]!.allowlist }
    );

    const { sourceTabId, destinationTabId } = await controlPage.evaluate(async (urls) => {
      const tabs = await chrome.tabs.query({});
      const source = tabs.find((t) => t.url?.includes(urls.source));
      const destination = tabs.find((t) => t.url?.includes(urls.destination));
      return { sourceTabId: source?.id, destinationTabId: destination?.id };
    }, { source: "doc-a1", destination: "doc-a2" });
    assert.ok(sourceTabId && destinationTabId, "expected to find both real browser tabs by URL");

    const captureResponse = await controlPage.evaluate(
      (tabId) => chrome.tabs.sendMessage(tabId!, { type: "SOURCE_CAPTURE" }),
      sourceTabId
    );
    assert.equal(captureResponse.ok, true, JSON.stringify(captureResponse));
    assert.ok(captureResponse.source.controls.length > 0);

    const compareResponse = await controlPage.evaluate(
      ({ tabId, source }) => chrome.tabs.sendMessage(tabId!, { type: "DESTINATION_COMPARE", source }),
      { tabId: destinationTabId, source: captureResponse.source }
    );
    assert.equal(compareResponse.ok, true, JSON.stringify(compareResponse));
    assert.equal(compareResponse.plan.unresolved.length, 0);
    assert.ok(compareResponse.plan.proposals.length > 0);

    const highlightCount = await destinationPage.evaluate(() => document.querySelectorAll("[data-rn-doc-runner-proposed]").length);
    assert.equal(highlightCount, compareResponse.plan.proposals.length, "the real destination page must show the highlighted proposals");

    const applyResponse = await controlPage.evaluate(
      ({ tabId, proposals }) => chrome.tabs.sendMessage(tabId!, { type: "PLAN_APPLY", proposals }),
      { tabId: destinationTabId, proposals: compareResponse.plan.proposals }
    );
    assert.equal(applyResponse.ok, true, JSON.stringify(applyResponse));
    assert.equal(applyResponse.result.applied, compareResponse.plan.proposals.length);

    const careChecked = await destinationPage.$eval("#ctrl-SNV-v1--page1--care_plan_reviewed", (el) => (el as HTMLInputElement).checked);
    assert.equal(careChecked, true, "the real destination DOM must reflect the applied change");

    // Same-tab comparison must be refused even through the real extension.
    const sameTabResult = await controlPage.evaluate(
      (tabId) => chrome.tabs.sendMessage(tabId!, { type: "DESTINATION_COMPARE", source: { identity: {}, controls: [] } }),
      sourceTabId
    );
    assert.equal(sameTabResult.ok, false);
  } finally {
    await context?.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
