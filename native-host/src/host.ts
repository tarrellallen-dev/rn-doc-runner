import type { Readable, Writable } from "node:stream";
import { NativeMessageDecoder, encodeMessage } from "./protocol.js";

export type NativeMessageResponder = (payload: unknown) => Promise<unknown>;

/**
 * Composable core: wires a readable/writable pair through the framing
 * decoder to a responder function. Takes plain streams (not
 * process.stdin/stdout directly) so it can be driven by fake streams in
 * tests without spawning a real subprocess.
 */
export function runNativeHost(stdin: Readable, stdout: Writable, respond: NativeMessageResponder): void {
  const decoder = new NativeMessageDecoder(
    (payload) => {
      respond(payload)
        .then((result) => stdout.write(encodeMessage(result)))
        .catch((error: unknown) => {
          stdout.write(encodeMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        });
    },
    (error) => {
      stdout.write(encodeMessage({ ok: false, error: error.message }));
    }
  );
  stdin.on("data", (chunk: Buffer) => decoder.push(chunk));
}
