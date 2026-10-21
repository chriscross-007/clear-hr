// Copies the pdf.js worker into /public so the in-app PDF viewer
// (src/components/documents/pdf-viewer.tsx) can load it from
// "/pdf.worker.min.mjs". Runs on every `npm install` (postinstall), so
// the worker always matches the installed pdfjs-dist version — locally
// and on Vercel. The copied file is git-ignored.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
let src;
try {
  src = join(dirname(require.resolve("pdfjs-dist/package.json")), "build", "pdf.worker.min.mjs");
} catch {
  console.warn("[copy-pdf-worker] pdfjs-dist not installed yet — skipping.");
  process.exit(0);
}
if (!existsSync(src)) {
  console.warn("[copy-pdf-worker] worker not found at", src);
  process.exit(0);
}
mkdirSync("public", { recursive: true });
copyFileSync(src, join("public", "pdf.worker.min.mjs"));
console.log("[copy-pdf-worker] copied pdf.worker.min.mjs to public/");
