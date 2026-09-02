/**
 * Static security scan core (Task 17 / PRIVACY_MODEL.md build review).
 * Pure, filesystem-parameterized logic so it can be unit-tested against
 * fixture directories, not just run blind against the real build.
 */
import fs from "node:fs";
import path from "node:path";

export interface Violation {
  file: string;
  rule: string;
  detail: string;
}

export const ANALYTICS_PATTERNS: [RegExp, string][] = [
  [/google-analytics\.com/i, "google_analytics"],
  [/googletagmanager\.com/i, "google_tag_manager"],
  [/segment\.(io|com)/i, "segment"],
  [/mixpanel/i, "mixpanel"],
  [/sentry\.io/i, "sentry"],
  [/bugsnag/i, "bugsnag"],
  [/amplitude\.com/i, "amplitude"],
  [/fullstory/i, "fullstory"],
  [/hotjar/i, "hotjar"],
  [/datadoghq/i, "datadog"]
];

export const DYNAMIC_CODE_PATTERNS: [RegExp, string][] = [
  [/\bnew\s+Function\s*\(/, "new_Function_constructor"],
  [/\beval\s*\(/, "eval_call"]
];

export const NETWORK_PATTERNS: [RegExp, string][] = [
  [/\bfetch\s*\(/, "fetch_call"],
  [/\bXMLHttpRequest\b/, "xhr_reference"],
  [/\bnew\s+WebSocket\s*\(/, "websocket_construction"],
  [/\bnavigator\.sendBeacon\b/, "send_beacon"]
];

export interface ContentCheck {
  patterns: [RegExp, string][];
  ruleName: string;
}

export function scanContent(content: string, checks: ContentCheck[]): { rule: string; detail: string }[] {
  const hits: { rule: string; detail: string }[] = [];
  for (const { patterns, ruleName } of checks) {
    for (const [pattern, label] of patterns) {
      if (pattern.test(content)) hits.push({ rule: ruleName, detail: label });
    }
  }
  return hits;
}

export const MISSING_ARTIFACT_RULE = "missing_build_artifact";

/**
 * A build gate that passes because the thing it was supposed to inspect
 * isn't there is worse than no gate at all: deleting `extension/dist/`
 * used to make this scan print "passed". Every artifact the scan expects
 * is therefore required to exist, and its absence is a violation carrying
 * the command that produces it.
 */
export function requireArtifact(projectRoot: string, targetPath: string, violations: Violation[]): boolean {
  if (fs.existsSync(targetPath)) return true;
  violations.push({
    file: path.relative(projectRoot, targetPath),
    rule: MISSING_ARTIFACT_RULE,
    detail: "expected build artifact not found - run `npm run build:production` before the security scan"
  });
  return false;
}

export function scanFile(projectRoot: string, filePath: string, checks: ContentCheck[], violations: Violation[]): void {
  if (!requireArtifact(projectRoot, filePath, violations)) return;
  const content = fs.readFileSync(filePath, "utf8");
  const relative = path.relative(projectRoot, filePath);
  for (const hit of scanContent(content, checks)) {
    violations.push({ file: relative, ...hit });
  }
}

/** Recursive worker: assumes `dir` exists, returns how many files it actually scanned. */
function scanDirectoryTree(projectRoot: string, dir: string, extensions: string[], checks: ContentCheck[], violations: Violation[]): number {
  let scanned = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanned += scanDirectoryTree(projectRoot, fullPath, extensions, checks, violations);
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      scanFile(projectRoot, fullPath, checks, violations);
      scanned += 1;
    }
  }
  return scanned;
}

/**
 * A present-but-empty `dist/` is the same vacuous pass as a missing one,
 * so a bundle directory that yields zero matching files is also a
 * violation rather than a silent zero-file success.
 */
export function scanDirectory(projectRoot: string, dir: string, extensions: string[], checks: ContentCheck[], violations: Violation[]): void {
  if (!requireArtifact(projectRoot, dir, violations)) return;
  if (scanDirectoryTree(projectRoot, dir, extensions, checks, violations) === 0) {
    violations.push({
      file: path.relative(projectRoot, dir),
      rule: MISSING_ARTIFACT_RULE,
      detail: `directory contains no ${extensions.join("/")} file - run \`npm run build:production\` before the security scan`
    });
  }
}

export const BROWSER_CONTEXT_CHECKS: ContentCheck[] = [
  { patterns: NETWORK_PATTERNS, ruleName: "forbidden_network_api" },
  { patterns: ANALYTICS_PATTERNS, ruleName: "forbidden_analytics_reference" },
  { patterns: DYNAMIC_CODE_PATTERNS, ruleName: "forbidden_dynamic_code_execution" }
];

/**
 * SECURITY_MODEL.md allows the desktop main process **local** network
 * calls only (the synthetic EHR on `localhost:4173` and its own Unix
 * socket). `sendBeacon` and `WebSocket` have no local-only use here and
 * are the two primitives an analytics/exfiltration path actually wants,
 * so they are refused outright; `fetch`/`XHR` are permitted but bounded
 * by findNonLoopbackUrls below, which is what makes "local" enforced rather
 * than merely documented.
 */
export const MAIN_PROCESS_FORBIDDEN_NETWORK_PATTERNS: [RegExp, string][] = [
  [/\bnavigator\.sendBeacon\b/, "send_beacon"],
  [/\bnew\s+WebSocket\s*\(/, "websocket_construction"]
];

export const MAIN_PROCESS_CHECKS: ContentCheck[] = [
  { patterns: MAIN_PROCESS_FORBIDDEN_NETWORK_PATTERNS, ruleName: "forbidden_network_api" },
  { patterns: ANALYTICS_PATTERNS, ruleName: "forbidden_analytics_reference" },
  { patterns: DYNAMIC_CODE_PATTERNS, ruleName: "forbidden_dynamic_code_execution" }
];

/** Hosts that count as "local" for the main-process network policy: loopback only. */
const LOOPBACK_HOST_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/**
 * Every absolute http(s) URL literal in a bundle, so its host can be
 * checked. The first alternative keeps a bracketed IPv6 authority
 * (`http://[::1]:4173/x`) intact, which a plain "not a bracket" character
 * class would truncate at the first `]`.
 */
const ABSOLUTE_URL_PATTERN = /\bhttps?:\/\/(\[[0-9a-f:]+\](?::\d+)?[^\s"'`\\)\]}<>,;]*|[^\s"'`\\)\]}<>,;]+)/gi;

/**
 * Returns every non-loopback http(s) destination literal in `content`.
 * Deliberately literal-only: a URL assembled at runtime from pieces
 * cannot be caught by a static scan, which SECURITY_MODEL.md states as a
 * known limit of this gate rather than pretending otherwise.
 */
export function findNonLoopbackUrls(content: string): string[] {
  const found: string[] = [];
  for (const match of content.matchAll(ABSOLUTE_URL_PATTERN)) {
    const url = match[0];
    const host = match[1]!.split("/")[0]!.split("@").pop()!.replace(/:\d+$/, "");
    if (!LOOPBACK_HOST_PATTERN.test(host) && !found.includes(url)) found.push(url);
  }
  return found;
}

/**
 * Scans a built main-process/preload bundle: the shared analytics and
 * dynamic-code rules, the outright-forbidden network primitives, and the
 * loopback-only destination rule that makes "local network calls only"
 * a build failure instead of a sentence in a document.
 */
export function scanMainProcessBundle(projectRoot: string, filePath: string, violations: Violation[]): void {
  if (!requireArtifact(projectRoot, filePath, violations)) return;
  scanFile(projectRoot, filePath, MAIN_PROCESS_CHECKS, violations);
  const relative = path.relative(projectRoot, filePath);
  for (const url of findNonLoopbackUrls(fs.readFileSync(filePath, "utf8"))) {
    violations.push({ file: relative, rule: "non_loopback_network_destination", detail: url });
  }
}

/**
 * Same vocabulary as @rn-doc-runner/rules' FINALIZATION_PATTERN (kept as
 * an independent literal, not an import, so this scanner keeps working
 * even if that package fails to build) — an IPC channel name is a
 * "command" in the Phase 2 / Task P2-4 sense, and none may imply an
 * electronic signature/attestation/submission/finalization action.
 */
const IPC_FINALIZATION_WORD_PATTERN = /\b(sign|attest\w*|submit\w*|finaliz\w*|finalis\w*|lock\w*|certif\w*|upload\w*|activate\w*)\b/i;

/** Scans a built main-process bundle for ipcMain.handle("channel", ...) registrations whose channel name itself implies a finalization command. */
export function scanIpcChannelNames(projectRoot: string, filePath: string, violations: Violation[]): void {
  if (!requireArtifact(projectRoot, filePath, violations)) return;
  const content = fs.readFileSync(filePath, "utf8");
  const relative = path.relative(projectRoot, filePath);
  const channelPattern = /ipcMain\.handle\(\s*["'`]([^"'`]+)["'`]/g;
  let match: RegExpExecArray | null;
  while ((match = channelPattern.exec(content)) !== null) {
    const channelName = match[1]!;
    if (IPC_FINALIZATION_WORD_PATTERN.test(channelName)) {
      violations.push({ file: relative, rule: "finalization_like_ipc_channel", detail: channelName });
    }
  }
}

/**
 * The disabled-adapter gate. Presence of `enabled: false` /
 * `status: "UNCONFIGURED"` is necessary but NOT sufficient: a second
 * exported adapter object carrying `enabled: true` would satisfy a
 * presence-only check while shipping an enabled adapter. So this asserts
 * the *absence* of any enabled/non-UNCONFIGURED literal in the file as
 * well, and scans the tsc-emitted `dist/index.js` too when a build has
 * produced one.
 */
export function scanDeveroAdapter(projectRoot: string, violations: Violation[]): void {
  const sourcePath = path.join(projectRoot, "adapters/devero-disabled/src/index.ts");
  if (!fs.existsSync(sourcePath)) {
    violations.push({ file: "adapters/devero-disabled/src/index.ts", rule: "devero_adapter_missing", detail: "file not found" });
    return;
  }

  const builtPath = path.join(projectRoot, "adapters/devero-disabled/dist/index.js");
  const targets = fs.existsSync(builtPath) ? [sourcePath, builtPath] : [sourcePath];

  for (const target of targets) {
    const relative = path.relative(projectRoot, target);
    const contents = fs.readFileSync(target, "utf8");
    // Comment prose in this file legitimately contains the words
    // `enabled: true` and "UNCONFIGURED"; strip comments before asserting
    // absence so the check reads code, not documentation.
    const code = contents.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/gm, "$1");

    if (!/enabled:\s*false/.test(code)) {
      violations.push({ file: relative, rule: "devero_adapter_not_disabled", detail: "enabled:false not found" });
    }
    if (!/status:\s*"UNCONFIGURED"/.test(code)) {
      violations.push({ file: relative, rule: "devero_adapter_not_unconfigured", detail: 'status:"UNCONFIGURED" not found' });
    }
    if (/enabled:\s*true/.test(code)) {
      violations.push({ file: relative, rule: "devero_adapter_enabled", detail: "enabled:true present" });
    }
    for (const match of code.matchAll(/status:\s*["'`]([^"'`]*)["'`]/g)) {
      if (match[1] !== "UNCONFIGURED") {
        violations.push({ file: relative, rule: "devero_adapter_not_unconfigured", detail: `status:"${match[1]}"` });
      }
    }
  }
}

/**
 * Runs every scan rule against a project root: extension bundle, desktop
 * renderer/main/preload bundles, manifest.json host permissions/CSP, and
 * confirms the real Devero adapter ships disabled/unconfigured.
 */
export function runSecurityScan(projectRoot: string): Violation[] {
  const violations: Violation[] = [];

  scanDirectory(projectRoot, path.join(projectRoot, "extension/dist"), [".js"], BROWSER_CONTEXT_CHECKS, violations);
  scanDirectory(projectRoot, path.join(projectRoot, "apps/desktop/dist/renderer"), [".js"], BROWSER_CONTEXT_CHECKS, violations);
  scanMainProcessBundle(projectRoot, path.join(projectRoot, "apps/desktop/dist/main.cjs"), violations);
  scanMainProcessBundle(projectRoot, path.join(projectRoot, "apps/desktop/dist/preload.cjs"), violations);
  scanIpcChannelNames(projectRoot, path.join(projectRoot, "apps/desktop/dist/main.cjs"), violations);

  const manifestPath = path.join(projectRoot, "extension/manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const hostPermissions: string[] = manifest.host_permissions ?? [];
    for (const permission of hostPermissions) {
      if (permission === "<all_urls>" || permission.includes("*://*/*") || permission.startsWith("*://*.")) {
        violations.push({ file: "extension/manifest.json", rule: "wildcard_host_permission", detail: permission });
      }
    }
    const csp: string = manifest.content_security_policy?.extension_pages ?? "";
    if (!/connect-src\s+'none'/.test(csp)) {
      violations.push({ file: "extension/manifest.json", rule: "missing_restrictive_csp", detail: csp || "(no CSP set)" });
    }
    for (const script of manifest.content_scripts ?? []) {
      for (const matchPattern of script.matches ?? []) {
        if (matchPattern === "<all_urls>" || matchPattern.includes("*://*/*")) {
          violations.push({ file: "extension/manifest.json", rule: "wildcard_content_script_match", detail: matchPattern });
        }
      }
    }
  } else {
    violations.push({ file: "extension/manifest.json", rule: "manifest_missing", detail: "extension/manifest.json not found" });
  }

  scanDeveroAdapter(projectRoot, violations);

  return violations;
}
