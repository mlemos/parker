import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  LINE_TAG,
  ORDER,
  cursorAfterRotate,
  nextInRotation,
  nextOnClick,
  norm,
  planRotate,
  type State,
} from "./todo-model.ts";

// ---- The state machine ----------------------------------------------------
// Every state must be reachable and every cycle must close, or a state becomes
// a trap the user can only leave by editing the raw text.

describe("norm", () => {
  it("folds every alias onto its canonical state", () => {
    const aliases: [string, State][] = [
      ["WIP", "DOING"],
      ["PAUSED", "PAUSE"],
      ["HOLD", "PAUSE"],
      ["WAITING", "WAIT"],
      ["BLOCKED", "WAIT"],
      ["MISSED", "FAIL"],
      ["DISMISSED", "CANCEL"],
    ];
    for (const [alias, canonical] of aliases) expect(norm(alias)).toBe(canonical);
  });

  it("leaves canonical states untouched", () => {
    for (const st of ORDER) expect(norm(st)).toBe(st);
  });
});

describe("LINE_TAG", () => {
  it("recognises every state and alias", () => {
    const tags = [...ORDER, "WIP", "PAUSED", "HOLD", "WAITING", "BLOCKED", "MISSED", "DISMISSED"];
    for (const tag of tags) expect(LINE_TAG.exec(`/${tag} something`)?.[2]).toBe(tag);
  });

  it("does not match words that merely start like a tag, or a tag mid-line", () => {
    const notTags = ["/WAITER x", "/PAUSES x", "/HOLDING x", "/DO x", "/TODOS x", "TODO x", "x /TODO"];
    for (const line of notTags) expect(LINE_TAG.exec(line)).toBeNull();
  });
});

describe("⌘⏎ rotation", () => {
  it("walks the whole order once and then clears the tag", () => {
    const walk: State[] = [];
    for (let st: State | null = ORDER[0]; st !== null; st = nextInRotation(st)) walk.push(st);
    expect(walk).toEqual([...ORDER]);
  });
});

describe("clicking a tag", () => {
  it("completes any open state", () => {
    for (const st of ["TODO", "DOING", "PAUSE", "WAIT", "ATTN"])
      expect(nextOnClick(st as State, false)).toBe("DONE");
  });

  it("reopens any closed state", () => {
    for (const st of ["DONE", "FAIL", "CANCEL"])
      expect(nextOnClick(st as State, false)).toBe("TODO");
  });

  it("cycles the open states under ⌥ and returns where it started", () => {
    const cycle: State[] = [];
    let cur: State = "TODO";
    do {
      cycle.push(cur);
      cur = nextOnClick(cur, true);
    } while (cur !== "TODO" && cycle.length <= ORDER.length + 1);
    expect(cycle).toEqual(["TODO", "DOING", "PAUSE", "WAIT", "ATTN", "FAIL", "CANCEL"]);
  });

  it("sends a done item back into the cycle under ⌥", () => {
    expect(nextOnClick("DONE", true)).toBe("ATTN");
  });
});

// ---- Cursor placement -----------------------------------------------------

describe("cursorAfterRotate", () => {
  // The cursor must never land in front of the tag ⌘⏎ just created, or the
  // next keystroke ends up outside it.
  const cases: [string, string, number, number][] = [
    ["an empty line, cursor at the start", "", 0, 6],
    ["existing text, cursor at the start", "buy milk", 0, 6],
    ["existing text, cursor mid-word", "buy milk", 5, 11],
  ];
  for (const [name, text, head, want] of cases) {
    it(`lands after the tag — ${name}`, () => {
      const doc = Text.of([text]);
      expect(cursorAfterRotate(planRotate(doc, head, head), head)).toBe(want);
    });
  }
});

// ---- Which lines a selection acts on --------------------------------------
// Brute-forced over every possible selection: the editor convention is the
// lines a selection covers, minus a trailing line it only touches at column 0,
// minus blank lines when several lines are selected. This is how the "tag lands
// on the line below" bug was found — selections ending at the start of the next
// line used to act on that next line.

const DOCS = {
  "no trailing newline": "# list\n\n\nfirst\nsecond\nthird",
  "trailing newline": "# list\n\n\nfirst\nsecond\nthird\n",
  "already tagged":
    "/TODO first\n/DOING second\n/PAUSE third\n/WAIT fourth\n/ATTN fifth\n/DONE sixth",
  indented: "  buy milk\n    call bank\nship",
};

function expected(doc: Text, from: number, to: number): number[] {
  const start = doc.lineAt(from);
  let end = doc.lineAt(to);
  const multi = end.number > start.number;
  if (multi && to === end.from) end = doc.lineAt(to - 1);
  const out: number[] = [];
  for (let n = start.number; n <= end.number; n++) {
    if (end.number > start.number && !doc.line(n).text.trim()) continue;
    out.push(n);
  }
  return out;
}

describe("planRotate over every selection", () => {
  for (const [name, str] of Object.entries(DOCS)) {
    it(`touches exactly the selected lines — ${name}`, () => {
      const doc = Text.of(str.split("\n"));
      const wrong: string[] = [];
      let checked = 0;
      for (let from = 0; from <= doc.length; from++) {
        for (let to = from; to <= doc.length; to++) {
          checked++;
          const got = [...new Set(planRotate(doc, from, to).map((c) => doc.lineAt(c.from).number))];
          const want = expected(doc, from, to);
          if (JSON.stringify(got) !== JSON.stringify(want))
            wrong.push(`[${from},${to}] want ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
        }
      }
      expect(checked).toBeGreaterThan(100);
      expect(wrong.slice(0, 10)).toEqual([]);
    });
  }
});
