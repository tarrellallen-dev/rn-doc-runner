import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [
    path.join(dir, "src/background.ts"),
    path.join(dir, "src/content.ts"),
    path.join(dir, "src/popup.ts")
  ],
  outdir: path.join(dir, "dist"),
  bundle: true,
  format: "iife",
  target: "chrome110",
  platform: "browser",
  sourcemap: false,
  minify: false,
  logLevel: "info"
});

console.log("extension bundle written to extension/dist/");
