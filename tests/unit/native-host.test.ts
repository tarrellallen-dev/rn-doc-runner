import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { encodeMessage, NativeMessageDecoder, MAX_MESSAGE_BYTES } from "@rn-doc-runner/native-host";
import { runNativeHost } from "@rn-doc-runner/native-host";
import { forwardToDesktopApp, createDefaultResponder } from "@rn-doc-runner/native-host";
import { startNativeBridgeServer } from "@rn-doc-runner/desktop/main/native-bridge-server";

test("encodeMessage/NativeMessageDecoder round-trip a JSON payload exactly", () => {
  const received: unknown[] = [];
  const decoder = new NativeMessageDecoder(
    (msg) => received.push(msg),
    () => assert.fail("unexpected decode error")
  );
  const encoded = encodeMessage({ type: "PING", count: 3, nested: { ok: true } });
  decoder.push(encoded);
  assert.deepEqual(received, [{ type: "PING", count: 3, nested: { ok: true } }]);
});

test("NativeMessageDecoder handles a message split across multiple chunks", () => {
  const received: unknown[] = [];
  const decoder = new NativeMessageDecoder(
    (msg) => received.push(msg),
    () => assert.fail("unexpected decode error")
  );
  const encoded = encodeMessage({ hello: "world", padding: "x".repeat(500) });
  decoder.push(encoded.subarray(0, 3)); // splits mid-length-header
  decoder.push(encoded.subarray(3, 10));
  decoder.push(encoded.subarray(10));
  assert.equal(received.length, 1);
  assert.equal((received[0] as { hello: string }).hello, "world");
});

test("NativeMessageDecoder decodes two back-to-back messages delivered in one chunk", () => {
  const received: unknown[] = [];
  const decoder = new NativeMessageDecoder(
    (msg) => received.push(msg),
    () => assert.fail("unexpected decode error")
  );
  decoder.push(Buffer.concat([encodeMessage({ n: 1 }), encodeMessage({ n: 2 })]));
  assert.deepEqual(received, [{ n: 1 }, { n: 2 }]);
});

test("a message length prefix beyond MAX_MESSAGE_BYTES is rejected rather than causing unbounded buffering", () => {
  const errors: Error[] = [];
  const decoder = new NativeMessageDecoder(
    () => assert.fail("unexpected message"),
    (err) => errors.push(err)
  );
  const header = Buffer.alloc(4);
  header.writeUInt32LE(MAX_MESSAGE_BYTES + 1, 0);
  decoder.push(header);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.message, "message_too_large");
});

test("encodeMessage itself refuses to encode an oversized payload", () => {
  assert.throws(() => encodeMessage({ big: "x".repeat(MAX_MESSAGE_BYTES) }), /message_too_large/);
});

test("malformed JSON bytes produce an onError callback, not a thrown exception", () => {
  const errors: Error[] = [];
  const decoder = new NativeMessageDecoder(
    () => assert.fail("unexpected message"),
    (err) => errors.push(err)
  );
  const badJson = Buffer.from("{not valid json", "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(badJson.length, 0);
  decoder.push(Buffer.concat([header, badJson]));
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.message, "invalid_json");
});

test("runNativeHost wires a fake stdin/stdout pair through a responder end-to-end", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const responses: unknown[] = [];
  const outDecoder = new NativeMessageDecoder(
    (msg) => responses.push(msg),
    () => assert.fail("unexpected decode error on stdout")
  );
  stdout.on("data", (chunk: Buffer) => outDecoder.push(chunk));

  runNativeHost(stdin, stdout, async (payload) => ({ ok: true, echoed: payload }));
  stdin.write(encodeMessage({ type: "PING" }));

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(responses, [{ ok: true, echoed: { type: "PING" } }]);
});

test("createDefaultResponder answers PING without touching the desktop-app socket", async () => {
  const responder = createDefaultResponder("/nonexistent/path/that/must/not/be/dialed.sock");
  const result = await responder({ type: "PING" });
  assert.deepEqual(result, { ok: true, type: "PONG" });
});

test("forwardToDesktopApp reports desktop_app_unavailable when no socket is listening", async () => {
  const result = await forwardToDesktopApp("/nonexistent/path/does/not/exist.sock", { type: "BATCH_STATUS" });
  assert.deepEqual(result, { ok: false, error: "desktop_app_unavailable" });
});

test("forwardToDesktopApp relays a request to a real local socket and returns its response", async () => {
  const socketPath = path.join(os.tmpdir(), `rn-doc-runner-test-${Date.now()}.sock`);
  const server = net.createServer((socket) => {
    socket.on("data", (chunk) => {
      const request = JSON.parse(chunk.toString("utf8").trim());
      socket.write(`${JSON.stringify({ ok: true, receivedType: request.type })}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  try {
    const result = await forwardToDesktopApp(socketPath, { type: "BATCH_STATUS" });
    assert.deepEqual(result, { ok: true, receivedType: "BATCH_STATUS" });
  } finally {
    server.close();
    fs.rmSync(socketPath, { force: true });
  }
});

test("startNativeBridgeServer handles two newline-delimited messages arriving in ONE chunk", async () => {
  // The desktop side of the bridge previously read only the first line of
  // each `data` event, so a second message packed into the same chunk was
  // left in the buffer and never answered until more bytes happened to
  // arrive. This is the newline-delimited mirror of the
  // NativeMessageDecoder back-to-back test above.
  const socketPath = path.join(os.tmpdir(), `rn-doc-runner-bridge-${process.pid}-${Date.now()}.sock`);
  const seen: unknown[] = [];
  const server = startNativeBridgeServer(socketPath, async (payload) => {
    seen.push(payload);
    return { ok: true, echoed: payload };
  });
  await new Promise<void>((resolve) => {
    if (server.listening) resolve();
    else server.once("listening", () => resolve());
  });

  try {
    const client = net.createConnection(socketPath);
    await new Promise<void>((resolve) => client.once("connect", () => resolve()));
    const responses: unknown[] = [];
    let inbound = "";
    client.on("data", (chunk: Buffer) => {
      inbound += chunk.toString("utf8");
      for (let i = inbound.indexOf("\n"); i !== -1; i = inbound.indexOf("\n")) {
        responses.push(JSON.parse(inbound.slice(0, i)));
        inbound = inbound.slice(i + 1);
      }
    });

    client.write(`${JSON.stringify({ type: "PING" })}\n${JSON.stringify({ type: "BATCH_STATUS" })}\n`);
    const deadline = Date.now() + 2000;
    while (responses.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    client.destroy();

    assert.deepEqual(seen, [{ type: "PING" }, { type: "BATCH_STATUS" }]);
    assert.deepEqual(responses, [
      { ok: true, echoed: { type: "PING" } },
      { ok: true, echoed: { type: "BATCH_STATUS" } }
    ]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(socketPath, { force: true });
  }
});

test("startNativeBridgeServer answers a message split across two chunks once it completes", async () => {
  const socketPath = path.join(os.tmpdir(), `rn-doc-runner-bridge-split-${process.pid}-${Date.now()}.sock`);
  const server = startNativeBridgeServer(socketPath, async (payload) => ({ ok: true, echoed: payload }));
  await new Promise<void>((resolve) => {
    if (server.listening) resolve();
    else server.once("listening", () => resolve());
  });

  try {
    const client = net.createConnection(socketPath);
    await new Promise<void>((resolve) => client.once("connect", () => resolve()));
    const line = JSON.stringify({ type: "PING", padding: "x".repeat(200) });
    client.write(line.slice(0, 40));
    await new Promise((resolve) => setTimeout(resolve, 20));
    client.write(`${line.slice(40)}\n`);
    const response = await new Promise<string>((resolve) => client.once("data", (chunk: Buffer) => resolve(chunk.toString("utf8"))));
    client.destroy();
    assert.deepEqual(JSON.parse(response.trim()), { ok: true, echoed: JSON.parse(line) });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(socketPath, { force: true });
  }
});
