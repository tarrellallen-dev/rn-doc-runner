/**
 * Popup UI: manual preview/apply workflow. Capture the source tab,
 * compare against the destination tab, review the highlighted proposal
 * on the actual page, then apply. The RN still saves/signs/submits
 * manually — this popup has no code path that can do either.
 */
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const applyButton = document.getElementById("apply") as HTMLButtonElement;

function report(message: string, isError = false): void {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#9f1239" : "#173d35";
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length !== 1 || !tabs[0]?.id) throw new Error("active_tab_unavailable");
  return tabs[0];
}

async function sendToTab(tabId: number, message: unknown): Promise<any> {
  const response = await chrome.tabs.sendMessage(tabId, message);
  if (!response?.ok) {
    const details = response?.failures?.join(", ") || response?.error || response?.stage || "operation_failed";
    throw new Error(details);
  }
  return response;
}

async function sessionMessage(message: unknown): Promise<any> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "session_operation_failed");
  return response;
}

document.getElementById("capture")?.addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    const response = await sendToTab(tab.id!, { type: "SOURCE_CAPTURE" });
    await sessionMessage({ type: "SOURCE_SET", sourceTabId: tab.id, source: response.source });
    applyButton.disabled = true;
    report(`Source verified and captured in temporary memory (${response.source.controls.length} allowlisted controls).`);
  } catch (error) {
    report(String((error as Error)?.message ?? error), true);
  }
});

document.getElementById("compare")?.addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    const session = (await sessionMessage({ type: "SESSION_GET" })).session;
    if (!session?.source) throw new Error("capture_source_first");
    if (session.sourceTabId === tab.id) throw new Error("destination_must_be_a_separate_tab");
    const response = await sendToTab(tab.id!, { type: "DESTINATION_COMPARE", source: session.source });
    await sessionMessage({ type: "PLAN_SET", destinationTabId: tab.id, plan: response.plan });
    applyButton.disabled = response.plan.proposals.length === 0;
    report(`${response.plan.proposals.length} proposed change(s) highlighted; unresolved: 0. Review the page before applying.`);
  } catch (error) {
    applyButton.disabled = true;
    report(String((error as Error)?.message ?? error), true);
  }
});

applyButton.addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    const session = (await sessionMessage({ type: "SESSION_GET" })).session;
    if (!session?.plan || session.destinationTabId !== tab.id) throw new Error("reviewed_plan_not_available_for_this_tab");
    if (session.plan.unresolved?.length) throw new Error("unresolved_items_block_apply");
    const response = await sendToTab(tab.id!, { type: "PLAN_APPLY", proposals: session.plan.proposals });
    applyButton.disabled = true;
    report(`${response.result.applied} reviewed change(s) applied. Review the page and save manually.`);
  } catch (error) {
    report(String((error as Error)?.message ?? error), true);
  }
});

document.getElementById("clear")?.addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    await chrome.tabs.sendMessage(tab.id!, { type: "HIGHLIGHTS_CLEAR" }).catch(() => undefined);
    await sessionMessage({ type: "SESSION_CLEAR" });
    applyButton.disabled = true;
    report("Temporary session cleared.");
  } catch (error) {
    report(String((error as Error)?.message ?? error), true);
  }
});

document.getElementById("emergency-stop")?.addEventListener("click", async () => {
  try {
    const tab = await activeTab().catch(() => undefined);
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "HIGHLIGHTS_CLEAR" }).catch(() => undefined);
    await sessionMessage({ type: "EMERGENCY_STOP" });
    applyButton.disabled = true;
    report("Emergency Stop: session cleared, no further actions will be taken.", true);
  } catch (error) {
    report(String((error as Error)?.message ?? error), true);
  }
});
