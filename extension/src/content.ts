/**
 * Content script: runs in the authenticated EHR tab itself. Reads
 * identity/allowlisted controls, compares source vs. destination via the
 * shared deterministic rule engine, highlights proposed changes, and
 * applies only after the RN-reviewed plan re-passes every allowlist
 * check at action time. Never touches Save, Sign, Submit, Send to
 * Office, or Finalize — there is no code path here that could.
 */
import * as rules from "@rn-doc-runner/rules";
import {
  readIdentityInPage,
  readControlsInPage,
  highlightProposalsInPage,
  applyProposalsInPage,
  clearHighlightsInPage
} from "@rn-doc-runner/form-engine";
import type { FieldAllowlistEntry, SiteAdapter } from "@rn-doc-runner/contracts";

const ADAPTER_STORAGE_KEY = "rnDocRunnerActiveAdapter";
// Deliberately separate from the site adapter: a site adapter's `allowlist`
// is the UNION of every approved form-version's fields (kept there only so
// the schema's "enabled adapters have a non-empty allowlist" check has
// something to validate). Reading that union against one page's DOM would
// try to locate every OTHER form's fields too and fail with zero-match
// errors. The orchestrator (popup for manual mode, native host for batch
// mode) must set this key to the CURRENT page's own FormAdapterPage
// allowlist before every capture/compare — exactly like
// @rn-doc-runner/queue-engine's batch machine does for its own in-process
// reads via @rn-doc-runner/form-engine.
const ACTIVE_ALLOWLIST_STORAGE_KEY = "rnDocRunnerActiveAllowlist";

async function loadAdapter(): Promise<SiteAdapter> {
  const stored = await chrome.storage.local.get(ADAPTER_STORAGE_KEY);
  const adapter = stored[ADAPTER_STORAGE_KEY] as SiteAdapter | undefined;
  if (!adapter) throw new Error("site_adapter_unconfigured");
  return adapter;
}

async function loadActiveAllowlist(): Promise<FieldAllowlistEntry[]> {
  const stored = await chrome.storage.local.get(ACTIVE_ALLOWLIST_STORAGE_KEY);
  const allowlist = stored[ACTIVE_ALLOWLIST_STORAGE_KEY] as FieldAllowlistEntry[] | undefined;
  if (!allowlist || allowlist.length === 0) throw new Error("active_form_allowlist_unconfigured");
  return allowlist;
}

function requireConfiguredAdapter(adapter: SiteAdapter): void {
  if (!adapter.enabled) throw new Error("site_adapter_unconfigured");
  if (adapter.status !== "APPROVED") throw new Error("site_adapter_not_approved");
  if (location.origin !== adapter.expectedOrigin) throw new Error("unexpected_origin");
  for (const [field, selector] of Object.entries(adapter.identitySelectors)) {
    if (!selector) throw new Error(`identity_selector_missing:${field}`);
  }
  if (!adapter.allowlist.length) throw new Error("field_allowlist_empty");
}

interface SourceCaptureMessage {
  type: "SOURCE_CAPTURE";
}
interface DestinationCompareMessage {
  type: "DESTINATION_COMPARE";
  source: { identity: Record<string, string>; controls: unknown[] };
}
interface PlanApplyMessage {
  type: "PLAN_APPLY";
  proposals: { key: string; type: string; checked?: boolean; value?: string }[];
}
interface HighlightsClearMessage {
  type: "HIGHLIGHTS_CLEAR";
}
type InboundMessage = SourceCaptureMessage | DestinationCompareMessage | PlanApplyMessage | HighlightsClearMessage;

async function handleMessage(message: InboundMessage) {
  const adapter = await loadAdapter();
  requireConfiguredAdapter(adapter);
  const allowlist = await loadActiveAllowlist();

  if (message.type === "SOURCE_CAPTURE") {
    const identityResult = readIdentityInPage(adapter.identitySelectors);
    if (!identityResult.ok || !identityResult.identity) return { ok: false, stage: "identity", failures: identityResult.failures };
    const controlsResult = readControlsInPage(allowlist);
    if (!controlsResult.ok || !controlsResult.controls) return { ok: false, stage: "controls", failures: controlsResult.failures };
    return { ok: true, source: { identity: identityResult.identity, controls: controlsResult.controls } };
  }

  if (message.type === "DESTINATION_COMPARE") {
    const identityResult = readIdentityInPage(adapter.identitySelectors);
    if (!identityResult.ok || !identityResult.identity) {
      clearHighlightsInPage();
      return { ok: false, stage: "identity", failures: identityResult.failures };
    }
    const verification = rules.verifyIdentity(message.source.identity, identityResult.identity, adapter.expectedAuthor);
    if (!verification.ok) {
      clearHighlightsInPage();
      return { ok: false, stage: "identity", failures: verification.failures };
    }
    const controlsResult = readControlsInPage(allowlist);
    if (!controlsResult.ok || !controlsResult.controls) {
      clearHighlightsInPage();
      return { ok: false, stage: "controls", failures: controlsResult.failures };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plan = rules.buildPlan(message.source.controls as any, controlsResult.controls, allowlist);
    if (plan.unresolved.length) {
      clearHighlightsInPage();
      return { ok: false, stage: "comparison", plan };
    }
    const highlightResult = highlightProposalsInPage({ proposals: plan.proposals, allowlist });
    if (!highlightResult.ok) return { ok: false, stage: "highlight", failures: highlightResult.failures };
    return { ok: true, plan };
  }

  if (message.type === "PLAN_APPLY") {
    const result = applyProposalsInPage({ proposals: message.proposals as never, allowlist });
    return { ok: result.ok, result };
  }

  if (message.type === "HIGHLIGHTS_CLEAR") {
    clearHighlightsInPage();
    return { ok: true };
  }

  return { ok: false, error: "unsupported_message" };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message as InboundMessage)
    .then(sendResponse)
    .catch((error: unknown) => {
      clearHighlightsInPage();
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});
