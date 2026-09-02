/** Removes the native messaging host manifest. Never touches anything else in the Chrome profile directory. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function chromeNativeMessagingHostsDir(): string {
  if (process.platform !== "darwin") {
    throw new Error("This installer currently supports macOS only (RN DOC Runner targets Mac).");
  }
  return path.join(os.homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts");
}

export function uninstall(): boolean {
  const targetPath = path.join(chromeNativeMessagingHostsDir(), "com.rndocrunner.native_host.json");
  if (!fs.existsSync(targetPath)) return false;
  fs.rmSync(targetPath);
  return true;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const removed = uninstall();
  console.log(removed ? "Native messaging host manifest removed." : "No native messaging host manifest was installed.");
}
