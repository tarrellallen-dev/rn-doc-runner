/**
 * Background service worker. Holds temporary session state
 * (source/plan) in chrome.storage.session only — never persistent
 * storage — and clears it on linked-tab close, explicit Clear, or
 * Emergency Stop. Optionally relays to the native messaging host so the
 * desktop app can drive a batch run; the extension works standalone
 * (manual preview/apply via the popup) even if no native host is
 * installed.
 */
const SESSION_KEY = "rnDocRunnerOperatorSession";
const NATIVE_HOST_NAME = "com.rndocrunner.native_host";

interface SessionState {
  sourceTabId?: number;
  source?: unknown;
  destinationTabId?: number;
  plan?: unknown;
  emergencyStopped?: boolean;
}

async function getSession(): Promise<SessionState> {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return (result[SESSION_KEY] as SessionState | undefined) ?? {};
}

async function setSession(session: SessionState): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEY]: session });
}

async function clearSession(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEY);
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await clearSession();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "SESSION_GET") {
      sendResponse({ ok: true, session: await getSession() });
      return;
    }
    if (message?.type === "SOURCE_SET") {
      await setSession({ sourceTabId: message.sourceTabId, source: message.source, plan: undefined });
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "PLAN_SET") {
      const session = await getSession();
      await setSession({ ...session, destinationTabId: message.destinationTabId, plan: message.plan });
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "SESSION_CLEAR") {
      await clearSession();
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "EMERGENCY_STOP") {
      await clearSession();
      await setSession({ emergencyStopped: true });
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: "unsupported_message" });
  })().catch((error: unknown) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await getSession();
  if (session.sourceTabId === tabId || session.destinationTabId === tabId) await clearSession();
});

// Best-effort native messaging connection. Absence of a native host
// (M7 not installed, or the user hasn't run the desktop app yet) must
// never break standalone manual preview/apply via the popup.
try {
  const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  port.onMessage.addListener((message) => {
    if (message?.type === "EMERGENCY_STOP") {
      clearSession().then(() => setSession({ emergencyStopped: true }));
    }
  });
  port.onDisconnect.addListener(() => {
    // Native host not installed/running — extension continues in standalone manual mode.
  });
} catch {
  // connectNative can throw synchronously if no native messaging host manifest is registered.
}
