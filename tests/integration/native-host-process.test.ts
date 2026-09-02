/** Spawns the REAL native-host executable wrapper as a subprocess and speaks the real framing protocol over its stdin/stdout. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeMessage, NativeMessageDecoder } from "@rn-doc-runner/native-host";

const PROJECT_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const WRAPPER_PATH = path.join(PROJECT_ROOT, "native-host/bin/rn-doc-runner-native-host");

test("the real native-host subprocess answers PING over its actual stdin/stdout", async () => {
  const child = spawn(WRAPPER_PATH, [], { stdio: ["pipe", "pipe", "pipe"] });
  const responses: unknown[] = [];
  const decoder = new NativeMessageDecoder(
    (msg) => responses.push(msg),
    () => assert.fail("unexpected decode error")
  );
  child.stdout.on("data", (chunk: Buffer) => decoder.push(chunk));
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  try {
    child.stdin.write(encodeMessage({ type: "PING" }));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for PONG; stderr: ${stderr}`)), 8000);
      const check = setInterval(() => {
        if (responses.length > 0) {
          clearInterval(check);
          clearTimeout(timer);
          resolve();
        }
      }, 50);
    });
    assert.deepEqual(responses, [{ ok: true, type: "PONG" }]);
  } finally {
    child.kill();
  }
});
