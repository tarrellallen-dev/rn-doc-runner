/**
 * Uninstallation script (Task 17). Removes only what RN DOC Runner
 * itself installs at the user level: the native messaging host manifest
 * and the app's own encrypted local state directory. Never touches
 * anything else on the Mac, and never touches the project folder.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uninstall as uninstallNativeHost } from "../native-host/scripts/uninstall.js";

console.log("RN DOC Runner — uninstall");
console.log("==========================");

try {
  const removed = uninstallNativeHost();
  console.log(removed ? "Removed native messaging host manifest." : "No native messaging host manifest was installed.");
} catch (error) {
  console.error(`Could not remove native messaging host manifest: ${error instanceof Error ? error.message : String(error)}`);
}

const userDataDir = path.join(os.homedir(), "Library/Application Support/@rn-doc-runner/desktop");
if (fs.existsSync(userDataDir)) {
  fs.rmSync(userDataDir, { recursive: true, force: true });
  console.log(`Removed app data directory: ${userDataDir}`);
} else {
  console.log("No app data directory found.");
}

console.log(`
The project folder itself (source code, git history) is left in place.
To remove the application entirely, delete the project folder yourself:
  rm -rf "<path to RN DOC RUNNER>"

To also remove the Chrome extension: open chrome://extensions, find
"RN DOC Runner", and click Remove. This is a manual Chrome action —
nothing here modifies your browser's extension list or settings.
`);
