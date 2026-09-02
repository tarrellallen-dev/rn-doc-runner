import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const SCRIPT = path.join(PROJECT_ROOT, "scripts/validate-adapter.ts");

function tmpJson(data: unknown): string {
  const filePath = path.join(os.tmpdir(), `rn-doc-runner-adapter-${Date.now()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data));
  return filePath;
}

test("validate-adapter accepts a well-formed disabled adapter", async () => {
  const filePath = tmpJson({
    enabled: false,
    status: "UNCONFIGURED",
    adapterVersion: "UNCONFIGURED",
    expectedOrigin: "https://example-ehr.invalid",
    expectedAuthor: "Nurse, Demo (RN)",
    identitySelectors: { patient: "", mr: "", form: "", date: "", author: "", page: "" },
    allowlist: []
  });
  const { stdout } = await execFileAsync("node", ["--import", "tsx", SCRIPT, filePath], { cwd: PROJECT_ROOT });
  assert.match(stdout, /Adapter schema is valid/);
  fs.rmSync(filePath, { force: true });
});

test("validate-adapter rejects an enabled adapter with an empty allowlist", async () => {
  const filePath = tmpJson({
    enabled: true,
    status: "APPROVED",
    adapterVersion: "v1",
    expectedOrigin: "https://example-ehr.invalid",
    expectedAuthor: "Nurse, Demo (RN)",
    identitySelectors: { patient: "#p", mr: "#m", form: "#f", date: "#d", author: "#a", page: "#pg" },
    allowlist: []
  });
  await assert.rejects(execFileAsync("node", ["--import", "tsx", SCRIPT, filePath], { cwd: PROJECT_ROOT }));
  fs.rmSync(filePath, { force: true });
});

test("validate-adapter fails on missing/unparseable file", async () => {
  await assert.rejects(execFileAsync("node", ["--import", "tsx", SCRIPT, "/nonexistent/adapter.json"], { cwd: PROJECT_ROOT }));
});
