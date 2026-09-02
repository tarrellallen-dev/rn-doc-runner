/**
 * Adapter installation/validation command (Task 17). Validates a site
 * adapter JSON file against the strict schema before it could ever be
 * considered for installation — never writes anything itself.
 *
 * Usage: node --import tsx scripts/validate-adapter.ts <path-to-adapter.json>
 */
import fs from "node:fs";
import { validateAdapterForInstall } from "../adapters/schema/src/index.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node --import tsx scripts/validate-adapter.ts <path-to-adapter.json>");
  process.exit(1);
}

let raw: unknown;
try {
  raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
} catch (error) {
  console.error(`Could not read/parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const result = validateAdapterForInstall(raw);
if (!result.ok) {
  console.error(`Adapter validation FAILED for ${filePath}:`);
  for (const failure of result.failures) console.error(`  - ${failure}`);
  process.exit(1);
}

const adapter = result.adapter;
console.log(`Adapter schema is valid: ${filePath}`);
console.log(`  adapterVersion: ${adapter.adapterVersion}`);
console.log(`  status: ${adapter.status}`);
console.log(`  enabled: ${adapter.enabled}`);
console.log(`  expectedOrigin: ${adapter.expectedOrigin}`);
console.log(`  allowlist entries: ${adapter.allowlist.length}`);
if (adapter.enabled) {
  console.log("\nThis adapter is ENABLED. Do not install it until every item in");
  console.log("RN DOC OS 12_LOCAL_OPERATOR/DEPLOYMENT_GATE.md and docs/DEPLOYMENT_CHECKLIST.md has passed and been signed off.");
} else {
  console.log("\nAdapter is disabled (safe default). Schema validity alone is not authorization to enable it.");
}
