/** CLI entry point. Fails closed: any violation is a nonzero exit, never a warning-only pass. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MISSING_ARTIFACT_RULE, runSecurityScan } from "./security-scan-lib.js";

const projectRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const violations = runSecurityScan(projectRoot);

if (violations.length === 0) {
  console.log(
    "Security scan passed: every expected build artifact present, no forbidden network/analytics/dynamic-code references, " +
      "no non-loopback network destination in the main process, no wildcard host permissions, Devero adapter remains disabled."
  );
  process.exit(0);
} else {
  console.error(`Security scan FAILED with ${violations.length} violation(s):`);
  for (const v of violations) {
    console.error(`  [${v.rule}] ${v.file}: ${v.detail}`);
  }
  if (violations.some((v) => v.rule === MISSING_ARTIFACT_RULE)) {
    console.error("\nThis scan inspects BUILT bundles. Run `npm run build:production` first; a scan that cannot find its inputs fails rather than passing vacuously.");
  }
  process.exit(1);
}
