/**
 * Forwards every native-messaging payload (except the host-level PING
 * health check) to the running desktop app over a local Unix domain
 * socket. The native host holds no batch/session state of its own — it
 * is a dumb relay — so if the desktop app isn't running, callers get an
 * explicit `desktop_app_unavailable` error rather than a host that
 * silently pretends to handle Emergency Stop or anything else on its
 * own.
 */
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const DEFAULT_SOCKET_PATH = path.join(os.homedir(), "Library/Application Support/RN DOC Runner/native-bridge.sock");

export function forwardToDesktopApp(socketPath: string, payload: unknown, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: unknown) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const socket = net.createConnection(socketPath);
    let responseBuffer = "";

    const timeout = setTimeout(() => {
      socket.destroy();
      finish({ ok: false, error: "desktop_app_unavailable_timeout" });
    }, timeoutMs);

    socket.on("connect", () => {
      socket.write(`${JSON.stringify(payload)}\n`);
    });
    socket.on("data", (chunk: Buffer) => {
      responseBuffer += chunk.toString("utf8");
      const newlineIndex = responseBuffer.indexOf("\n");
      if (newlineIndex === -1) return;
      clearTimeout(timeout);
      try {
        finish(JSON.parse(responseBuffer.slice(0, newlineIndex)));
      } catch {
        finish({ ok: false, error: "desktop_app_invalid_response" });
      }
      socket.destroy();
    });
    socket.on("error", () => {
      clearTimeout(timeout);
      finish({ ok: false, error: "desktop_app_unavailable" });
    });
  });
}

export function createDefaultResponder(socketPath: string = DEFAULT_SOCKET_PATH): (payload: unknown) => Promise<unknown> {
  return async (payload: unknown) => {
    const message = payload as { type?: string };
    if (message?.type === "PING") return { ok: true, type: "PONG" };
    return forwardToDesktopApp(socketPath, payload);
  };
}
