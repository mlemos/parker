// The Vite build of the note painter for the iPhone: src/lib/paint-entry.ts as
// one self-contained IIFE script with a global `ParkerPaint`, nothing written
// to disk (the caller decides) — shared by the exporter and the staleness test.
export const paintBundleConfig = (root) => ({
  root,
  configFile: false,
  logLevel: "silent",
  build: {
    write: false,
    emptyOutDir: false,
    minify: "esbuild",
    target: "es2020",
    lib: { entry: `${root}/src/lib/paint-entry.ts`, name: "ParkerPaint", formats: ["iife"], fileName: () => "parker-paint.js" },
  },
});
