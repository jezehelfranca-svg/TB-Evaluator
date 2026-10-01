// Build the app into ONE self-contained HTML file (no network access needed at runtime).
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "Universal_TBE_Workbench.html");

// `import x from "file?raw"` -> file contents as a string (used for the pdf.js worker).
const rawPlugin = {
  name: "raw",
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, async (args) => {
      const r = await b.resolve(args.path.replace(/\?raw$/, ""), { resolveDir: args.resolveDir, kind: "import-statement" });
      return { path: r.path, namespace: "raw" };
    });
    b.onLoad({ filter: /.*/, namespace: "raw" }, (args) => ({ contents: readFileSync(args.path, "utf8"), loader: "text" }));
  },
};

const result = await build({
  entryPoints: [resolve(root, "src/ui/main.tsx")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2020", "chrome100", "edge100", "firefox100", "safari15"],
  minify: true,
  write: false,
  jsx: "automatic",
  jsxImportSource: "preact",
  alias: { exceljs: "exceljs/dist/exceljs.min.js" },
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
  legalComments: "eof",
  plugins: [rawPlugin],
  logLevel: "warning",
});

const scriptSafe = (s) => s.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
const js = scriptSafe(result.outputFiles[0].text);
const css = readFileSync(resolve(root, "src/ui/styles.css"), "utf8");

// Keep in sync with pageTemplate() in src/ui/files.ts.
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Universal TBE Workbench</title>
<style id="utbe-css">${css}</style>
</head>
<body>
<div id="app"></div>
<script id="utbe-project" type="application/json"></script>
<script id="utbe-js" type="module">${js}</script>
</body>
</html>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`Built ${out} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
