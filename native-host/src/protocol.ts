/**
 * Chrome Native Messaging framing (Task 7): each message is a 4-byte
 * little-endian length prefix followed by that many bytes of UTF-8 JSON.
 * Enforces a defensive maximum message size in both directions so a
 * malformed or hostile length prefix can never make the host allocate
 * unbounded memory.
 */

/** Matches Chrome's own 1 MiB limit on messages sent FROM an extension; enforced symmetrically here. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

export function encodeMessage(payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  if (json.length > MAX_MESSAGE_BYTES) throw new Error("message_too_large");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

export type MessageHandler = (payload: unknown) => void;
export type ErrorHandler = (error: Error) => void;

/**
 * Incrementally decodes a stream of length-prefixed JSON messages from
 * arbitrary-sized chunks (stdin delivers data in whatever chunks the OS
 * pipe buffer gives it, not necessarily aligned to message boundaries).
 */
export class NativeMessageDecoder {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  constructor(
    private readonly onMessage: MessageHandler,
    private readonly onError: ErrorHandler
  ) {}

  push(chunk: Buffer<ArrayBufferLike>): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 4) return;
      const length = this.buffer.readUInt32LE(0);
      if (length > MAX_MESSAGE_BYTES) {
        this.onError(new Error("message_too_large"));
        this.buffer = Buffer.alloc(0);
        return;
      }
      if (this.buffer.length < 4 + length) return;
      const jsonBytes = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      try {
        this.onMessage(JSON.parse(jsonBytes.toString("utf8")));
      } catch {
        this.onError(new Error("invalid_json"));
      }
    }
  }
}
