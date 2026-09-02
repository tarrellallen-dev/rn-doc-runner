/**
 * First-run setup wizard (Task 17). Builds everything needed for a
 * working Synthetic Development Mode install, entirely inside the
 * project folder. Never writes outside the project or installs
 * anything at the user/system level automatically — the one step that
 * does (registering the native messaging host in Chrome's per-user
 * profile directory) is printed as an explicit command for you to run,
 * not executed here.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");

function run(command: string, args: string[], cwd: string = PROJECT_ROOT): boolean {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  return result.status === 0;
}

console.log("RN DOC Runner — first-run setup (Synthetic Development Mode)");
console.log("================================================================");

console.log("\n[1/5] Building shared TypeScript packages...");
if (!run("npm", ["run", "build", "--workspaces", "--if-present"])) {
  console.error("Package build failed. Fix the error above and re-run this script.");
  process.exit(1);
}

console.log("\n[2/5] Building the local OCR helper (Apple Vision, Swift)...");
const ocrBinary = path.join(PROJECT_ROOT, "ocr-helper/.build/release/ocr-helper");
if (fs.existsSync(ocrBinary)) {
  console.log("Already built, skipping.");
} else if (!run("swift", ["build", "-c", "release"], path.join(PROJECT_ROOT, "ocr-helper"))) {
  console.error("Swift build failed. RN DOC Runner requires a Mac with Command Line Tools or Xcode installed.");
  process.exit(1);
}

console.log("\n[3/5] Building the Chrome extension bundle...");
if (!run("npm", ["run", "build", "--workspace=@rn-doc-runner/extension"])) process.exit(1);

console.log("\n[4/5] Building the desktop app bundle...");
if (!run("npm", ["run", "build", "--workspace=@rn-doc-runner/desktop"])) process.exit(1);

console.log("\n[5/5] Running the security scan on the built bundles...");
if (!run("node", ["--import", "tsx", "scripts/security-scan.ts"])) {
  console.error("Security scan failed — see violations above.");
  process.exit(1);
}

console.log(`
================================================================
Setup complete. Everything above ran only inside:
  ${PROJECT_ROOT}

Next steps:

1. Start the synthetic EHR (separate terminal):
   npm run synthetic-ehr:start

2. Launch the desktop app:
   npm run start --workspace=@rn-doc-runner/desktop

3. Load the Chrome extension (manual, one-time):
   - Open chrome://extensions
   - Enable "Developer mode" (top right)
   - Click "Load unpacked" and select:
       ${path.join(PROJECT_ROOT, "extension")}
   - Note the Extension ID Chrome assigns it.

4. (Optional) Register the native messaging host so the extension can
   talk to the desktop app. This is the one step that writes outside the
   project folder (into Chrome's own per-user NativeMessagingHosts
   directory) — run it yourself once you have the Extension ID from
   step 3:
       npm run install-host --workspace=@rn-doc-runner/native-host -- <extensionId>

   To remove it later:
       npm run uninstall-host --workspace=@rn-doc-runner/native-host

Run the test suite any time with: npm test
Run only the security scan with:  npm run security:scan
`);
