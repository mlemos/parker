import { describe, expect, it } from "vitest";
import type { WriteOutcome } from "./api.ts";
import { guardedSave } from "./guarded-save.ts";
import type { SaveDeps } from "./guarded-save.ts";
import type { Buffer } from "./layout.ts";
import type { OwnWrite } from "./workspace.ts";

const buf = (content: string, disk: string): Buffer => ({ name: "n.md", content, disk, dirty: content !== disk });

/** A fake disk: one file, written only as the guard allows, with a log of
 *  what was recorded as Parker's own and when. */
function disk(initial: string | null, opts: { readFails?: string } = {}) {
  let file = initial;
  const log: string[] = [];
  let own: OwnWrite | undefined;
  const d: SaveDeps = {
    async write(content, expected): Promise<WriteOutcome> {
      log.push(`write (own recorded: ${own?.text ?? "none"})`);
      if (file === null) return { kind: "missing" };
      if (file === content) return { kind: "written" };
      if (!expected.includes(file)) return { kind: "changed", disk: file };
      file = content;
      return { kind: "written" };
    },
    async read() {
      if (opts.readFails) throw new Error(opts.readFails);
      if (file === null) throw new Error("No such file or directory (os error 2)");
      return file;
    },
    record(o) {
      own = o;
    },
    async wait() {},
  };
  return { d, log, file: () => file, own: () => own, set: (t: string | null) => (file = t) };
}

describe("guardedSave", () => {
  it("writes when the file is as Parker last saw it", async () => {
    const f = disk("old");
    expect(await guardedSave(buf("new", "old"), undefined, f.d)).toEqual({ kind: "saved", written: "new" });
    expect(f.file()).toBe("new");
    expect(f.own()).toEqual({ text: "new", seq: 1 });
  });

  it("records its own write before the write goes out", async () => {
    const f = disk("old");
    await guardedSave(buf("new", "old"), undefined, f.d);
    expect(f.log).toEqual(["write (own recorded: new)"]);
  });

  it("never writes over a change the watcher did not report: it opens a conflict", async () => {
    const f = disk("theirs");
    expect(await guardedSave(buf("mine", "old"), undefined, f.d)).toEqual({ kind: "conflict", disk: "theirs" });
    expect(f.file()).toBe("theirs");
  });

  it("puts the own-write record back when nothing was written, keeping the count moved on", async () => {
    const f = disk("theirs");
    await guardedSave(buf("mine", "old"), { text: "old", seq: 4 }, f.d);
    expect(f.own()).toEqual({ text: "old", seq: 5 });
    const g = disk("theirs");
    await guardedSave(buf("mine", "old"), undefined, g.d);
    expect(g.own()).toBeUndefined();
  });

  it("takes Parker's own last write as the file's text when the baseline lags it", async () => {
    // The editor's baseline still says "old"; Parker wrote "v1" a moment ago.
    const f = disk("v1");
    expect(await guardedSave(buf("v2", "old"), { text: "v1", seq: 1 }, f.d)).toEqual({ kind: "saved", written: "v2" });
    expect(f.file()).toBe("v2");
  });

  it("a file already holding the text is saved, whoever wrote it", async () => {
    const f = disk("same");
    expect(await guardedSave(buf("same", "old"), undefined, f.d)).toEqual({ kind: "saved", written: "same" });
  });

  it("a file that is gone stays gone", async () => {
    const f = disk(null);
    expect(await guardedSave(buf("x", "old"), undefined, f.d)).toEqual({ kind: "gone" });
    expect(f.file()).toBeNull();
  });

  it("a file missing a moment and back is saved again, not called gone", async () => {
    const f = disk(null);
    f.d.wait = async () => {
      f.set("old"); // a tool replacing the file: back after the moment
    };
    expect(await guardedSave(buf("x", "old"), undefined, f.d)).toEqual({ kind: "retry" });
  });

  it("a file iCloud holds and this Mac doesn't is not gone", async () => {
    const f = disk(null, { readFails: "not-local: This note is in iCloud and isn't on this Mac yet" });
    expect(await guardedSave(buf("x", "old"), undefined, f.d)).toEqual({ kind: "retry" });
  });

  it("a write that fails says so", async () => {
    const f = disk("old");
    f.d.write = async () => {
      throw new Error("disk full");
    };
    expect(await guardedSave(buf("x", "old"), undefined, f.d)).toEqual({ kind: "error", message: "disk full" });
  });
});
