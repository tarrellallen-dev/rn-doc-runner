/**
 * The desktop-app side of the native-host bridge (Task 6/7): a local
 * Unix domain socket the native-host process connects to and forwards
 * extension-originated messages over (newline-delimited JSON), so the
 * app can react to Emergency Stop or report batch status even when
 * driven from the Chrome extension side rather than the desktop UI.
 */
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const DEFAULT_SOCKET_PATH = path.join(os.homedir(), "Library/Application Support/RN DOC Runner/native-bridge.sock");

export type BridgeMessageHandler = (payload: unknown) => Promise<unknown>;

export function startNativeBridgeServer(socketPath: string, handler: BridgeMessageHandler): net.Server {
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  if (fs.existsSync(socketPath)) fs.rmSync(socketPath); // stale socket left by a previous crashed run

  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      // A TCP/Unix-socket chunk is not a message boundary: one `data`
      // event can carry several complete newline-delimited messages (and
      // a trailing partial one). Drain every complete line, exactly as
      // native-host/src/protocol.ts's decoder does for the length-prefixed
      // direction — handling only the first would stall every message
      // after it until more bytes happened to arrive.
      for (;;) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) return;
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.trim() === "") continue;
        (async () => {
          try {
            const result = await handler(JSON.parse(line));
            socket.write(`${JSON.stringify(result)}\n`);
          } catch (error) {
            socket.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
          }
        })();
      }
    });
  });

  server.listen(socketPath);
  return server;
}
