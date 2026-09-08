import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import fixtures from "../../shared/fixtures/todo-model.json";
import {
  LINE_TAG,
  ORDER,
  cursorAfterRotate,
  nextInRotation,
  nextOnClick,
  norm,
  ownersForRange,
  planRotate,
  type State,
} from "./todo-model.ts";

// The fixtures are shared with the Swift port (ios/ParkerCore): the same JSON
// drives both suites, so the two grammars cannot drift apart unnoticed.
interface Fixtures {
  order: State[];
  aliases: Record<string, State>;
  notTags: string[];
  click: { completes: State[]; reopens: State[]; altCycle: State[]; altFromDone: State };
  cursorCases: { name: string; text: string; head: number; want: number }[];
  sweepDocs: Record<string, string>;
  ownerCases: { name: string; lines: string[]; from?: number; to?: number; want: (State | null)[] }[];
}
const FX = fixtures as unknown as Fixtures;

// ---- The state machine ----------------------------------------------------
// Every state must be reachable and every cycle must close, or a state becomes
// a trap the user can only leave by editing the raw text.

describe("norm", () => {
  it("folds every alias onto its canonical state", () => {
    for (const [alias, canonical] of Object.entries(FX.aliases)) expect(norm(alias)).toBe(canonical);
  });

  it("leaves canonical states untouched, in the fixture's order", () => {
    expect([...ORDER]).toEqual(FX.order);
    for (const st of ORDER) expect(norm(st)).toBe(st);
  });
});

describe("LINE_TAG", () => {
  it("recognises every state and alias", () => {
    const tags = [...FX.order, ...Object.keys(FX.aliases)];
    for (const tag of tags) expect(LINE_TAG.exec(`/${tag} something`)?.[2]).toBe(tag);
  });

  it("does not match words that merely start like a tag, or a tag mid-line", () => {
    for (const line of FX.notTags) expect(LINE_TAG.exec(line)).toBeNull();
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
    for (const st of FX.click.completes) expect(nextOnClick(st, false)).toBe("DONE");
  });

  it("reopens any closed state", () => {
    for (const st of FX.click.reopens) expect(nextOnClick(st, false)).toBe("TODO");
  });

  it("cycles the open states under ⌥ and returns where it started", () => {
    const cycle: State[] = [];
    let cur: State = "TODO";
    do {
      cycle.push(cur);
      cur = nextOnClick(cur, true);
    } while (cur !== "TODO" && cycle.length <= ORDER.length + 1);
    expect(cycle).toEqual(FX.click.altCycle);
  });

  it("sends a done item back into the cycle under ⌥", () => {
    expect(nextOnClick("DONE", true)).toBe(FX.click.altFromDone);
  });
});

// ---- Cursor placement -----------------------------------------------------

describe("cursorAfterRotate", () => {
  // The cursor must never land in front of the tag ⌘⏎ just created, or the
  // next keystroke ends up outside it.
  for (const { name, text, head, want } of FX.cursorCases) {
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

const DOCS = FX.sweepDocs;

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

// ---- Which to-do owns a line ----------------------------------------------

describe("ownersForRange", () => {
  /** `doc` is written as one line per array entry — no trailing blank. */
  const owners = (lines: string[], from = 1, to?: number) => {
    const d = Text.of(lines);
    return ownersForRange(d, from, to ?? d.lines);
  };

  for (const { name, lines, from, to, want } of FX.ownerCases) {
    it(name, () => {
      expect(owners(lines, from ?? 1, to)).toEqual(want);
    });
  }
});
