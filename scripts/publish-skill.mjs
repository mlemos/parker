// Publish the Parker skill on the site, so what agents download is the file
// the app installs.
//
//   node scripts/publish-skill.mjs          write site/agents/SKILL.md + .zip
//   node scripts/publish-skill.mjs --check  fail if they are stale (CI)
//
// Source: skills/parker/SKILL.md. Output:
//   site/agents/SKILL.md          the skill, byte for byte
//   site/agents/parker-skill.zip  parker/SKILL.md, the layout the Claude app
//                                 uploads; stored (no compression) with a fixed
//                                 date, so it only changes when the skill does
// The page itself (site/agents/index.html) is hand-written like the others.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { crc32 } from "node:zlib";
import { fileURLToPath } from "node:url";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const skill = readFileSync(at("../skills/parker/SKILL.md"), "utf8");

/** A zip of the given entries, stored and dated 2026-01-01, so the bytes are
 *  a function of the content alone. Directories end in "/". */
function zip(entries) {
  const DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(text ?? "", "utf8");
    const crc = crc32(data) >>> 0;
    const dir = name.endsWith("/");
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8 names
    h.writeUInt16LE(0, 8); // stored
    h.writeUInt16LE(0, 10);
    h.writeUInt16LE(DATE, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    h.writeUInt16LE(0, 28);
    local.push(h, nameBuf, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, v2.0
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(0, 12);
    c.writeUInt16LE(DATE, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34);
    c.writeUInt16LE(0, 36);
    // Unix mode in the high half: a folder 755, a file 644.
    c.writeUInt32LE((((dir ? 0o40755 : 0o100644) << 16) | (dir ? 0x10 : 0)) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += h.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

const out = {
  "site/agents/SKILL.md": Buffer.from(skill, "utf8"),
  "site/agents/parker-skill.zip": zip([["parker/", ""], ["parker/SKILL.md", skill]]),
};

if (process.argv.includes("--check")) {
  const stale = Object.entries(out).filter(([p, buf]) => {
    const f = at("../" + p);
    return !existsSync(f) || !readFileSync(f).equals(buf);
  });
  if (stale.length) {
    console.error("site/agents is out of date with skills/parker/SKILL.md:");
    for (const [p] of stale) console.error("  " + p);
    console.error("Run: node scripts/publish-skill.mjs");
    process.exit(1);
  }
  console.log("site/agents matches the skill.");
} else {
  mkdirSync(at("../site/agents"), { recursive: true });
  for (const [p, buf] of Object.entries(out)) writeFileSync(at("../" + p), buf);
  console.log("Wrote " + Object.keys(out).join(", "));
}
