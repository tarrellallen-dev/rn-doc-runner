import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(dir, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "renderer"), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(dir, "src/main/main.ts")],
  outfile: path.join(dist, "main.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  // playwright (used only by Synthetic Development Mode's batch runner) has
  // native/optional-dependency loading that doesn't bundle cleanly; left
  // external, it resolves normally via node_modules at runtime instead.
  external: ["electron", "playwright", "playwright-core"],
  logLevel: "info"
});

await esbuild.build({
  entryPoints: [path.join(dir, "src/preload/preload.ts")],
  outfile: path.join(dist, "preload.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  logLevel: "info"
});

await esbuild.build({
  entryPoints: [path.join(dir, "src/renderer/main.tsx")],
  outfile: path.join(dist, "renderer/renderer.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome110",
  jsx: "automatic",
  logLevel: "info"
});

fs.copyFileSync(path.join(dir, "src/renderer/index.html"), path.join(dist, "renderer/index.html"));

console.log("desktop app bundle written to apps/desktop/dist/");
