/**
 * Installs the native messaging host manifest so Chrome will launch our
 * wrapper script for the given extension ID. Writes only inside the
 * user's own Chrome native-messaging-hosts directory — never touches
 * Chrome policy, never modifies other extensions/hosts.
 *
 * Usage: node --import tsx scripts/install.ts <extensionId>
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NATIVE_HOST_DIR = path.resolve(fileURLToPath(import.meta.url), "../..");
const TEMPLATE_PATH = path.join(NATIVE_HOST_DIR, "com.rndocrunner.native_host.json.template");
const WRAPPER_PATH = path.join(NATIVE_HOST_DIR, "bin/rn-doc-runner-native-host");

function chromeNativeMessagingHostsDir(): string {
  if (process.platform !== "darwin") {
    throw new Error("This installer currently supports macOS only (RN DOC Runner targets Mac).");
  }
  return path.join(os.homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts");
}

export function install(extensionId: string): string {
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error(`extension id does not look like a Chrome extension id: ${extensionId}`);
  }
  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const manifest = template
    .replace("__NATIVE_HOST_WRAPPER_PATH__", WRAPPER_PATH)
    .replace("__EXTENSION_ID__", extensionId);

  const targetDir = chromeNativeMessagingHostsDir();
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, "com.rndocrunner.native_host.json");
  fs.writeFileSync(targetPath, manifest, "utf8");
  fs.chmodSync(WRAPPER_PATH, 0o755);
  return targetPath;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const extensionId = process.argv[2];
  if (!extensionId) {
    console.error("Usage: node --import tsx scripts/install.ts <extensionId>");
    console.error('Find the extension ID at chrome://extensions after loading extension/ as an unpacked extension.');
    process.exit(1);
  }
  const targetPath = install(extensionId);
  console.log(`Installed native messaging host manifest at:\n  ${targetPath}`);
  console.log("Restart Chrome for the change to take effect.");
}
