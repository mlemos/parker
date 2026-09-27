// The file Parker's updater reads (Onda 6): latest.json, published with each
// GitHub release next to the DMG. Every installed Parker asks for
//   https://github.com/mlemos/parker/releases/latest/download/latest.json
// and, when the version in it is newer than its own, offers the update — the
// .app.tar.gz at `url`, checked against `signature` with the public key
// built into the app.
//
//   node scripts/gen-latest-json.mjs [notes.md]   → src-tauri/target/release/bundle/latest.json
//
// The version comes from package.json; the signature from the .sig that
// `tauri build` writes next to the archive (createUpdaterArtifacts), signed
// with the key build-signed.sh reads from the keychain. Release notes: the
// file given, or none.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ARCHIVE = "Parker.app.tar.gz";

/** The latest.json for one release. Only Apple Silicon for now (decided
 *  25/09): a Mac Intel gets no platform entry, so it's never offered one. */
export function latestJson({ version, notes, signature, date, repo = "mlemos/parker" }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`not a version: ${version}`);
  if (!signature || !signature.trim()) throw new Error("no signature");
  return {
    version,
    notes: notes ?? "",
    pub_date: new Date(date).toISOString(),
    platforms: {
      "darwin-aarch64": {
        signature: signature.trim(),
        url: `https://github.com/${repo}/releases/download/v${version}/${ARCHIVE}`,
      },
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL("../", import.meta.url);
  const version = JSON.parse(readFileSync(new URL("package.json", root), "utf8")).version;
  const bundle = new URL("src-tauri/target/release/bundle/", root);
  const sigFile = new URL(`macos/${ARCHIVE}.sig`, bundle);
  if (!existsSync(sigFile)) {
    console.error(`No ${ARCHIVE}.sig in the bundle — run build-signed.sh first (it signs the updater archive).`);
    process.exit(1);
  }
  const notes = process.argv[2] ? readFileSync(process.argv[2], "utf8").trim() : "";
  const json = latestJson({ version, notes, signature: readFileSync(sigFile, "utf8"), date: Date.now() });
  const out = new URL("latest.json", bundle);
  writeFileSync(out, JSON.stringify(json, null, 2) + "\n");
  console.log(`latest.json for ${version} → ${fileURLToPath(out)}`);
}
