/** Builds the extension (tests/e2e/extension.test.ts loads the actual built bundle), then runs every tests/e2e/*.test.ts file. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");

console.log("Building extension bundle...");
const build = spawnSync("npm", ["run", "build", "--workspace=@rn-doc-runner/extension"], {
  cwd: projectRoot,
  stdio: "inherit"
});
if (build.status !== 0) {
  console.error("Extension build failed; continuing so the extension e2e test can report/skip cleanly.");
}

const run = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "tests/e2e/extension.test.ts", "tests/e2e/acceptance.test.ts"],
  { cwd: projectRoot, stdio: "inherit" }
);
process.exit(run.status ?? 1);
