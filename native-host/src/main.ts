/** Real process entry point. Chrome launches this as a subprocess when the extension calls connectNative. */
import { runNativeHost } from "./host.js";
import { createDefaultResponder } from "./desktop-bridge.js";

runNativeHost(process.stdin, process.stdout, createDefaultResponder());
