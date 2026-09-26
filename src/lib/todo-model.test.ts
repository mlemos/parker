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
  planBang,
  planEnter,
  planMarkerDelete,
  planLineDelete,
  planRotate,
  priorityOf,
  planPriority,
  tagChange,
  type Change,
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
  priority: {
    tags: { line: string; word: string; level: number }[];
    notTags: string[];
    rotate: { line: string; after: string }[];
    click: { line: string; alt: boolean; after: string }[];
    step: { name: string; doc: string; from: number; to: number; delta: 1 | -1; after: string }[];
  };
  enter: {
    cases: { line: string; col: number; kind: "newline" | "continue" | "exit"; prefix?: string; from?: number; to?: number }[];
  };
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

// ---- Priority --------------------------------------------------------------
// Bangs glued to the tag are part of it: recognised by the grammar, kept behind
// the box, and carried along when the state rotates or is clicked. The Mac
// shows nothing for them yet; the iPhone does. Same fixtures on both sides.

/** Apply changes (as planRotate/tagChange produce them) to a one-line doc. */
function applied(text: string, changes: Change[]): string {
  let out = text;
  for (const c of [...changes].sort((a, b) => b.from - a.from))
    out = out.slice(0, c.from) + (c.insert ?? "") + out.slice(c.to ?? c.from);
  return out;
}

describe("priority bangs", () => {
  it("are read off the tag, 0 to 3", () => {
    for (const { line, word, level } of FX.priority.tags) {
      const tag = LINE_TAG.exec(line);
      expect(tag?.[2], line).toBe(word);
      expect(tag && priorityOf(tag), line).toBe(level);
    }
  });

  it("do not make a tag out of four bangs, a bang before a letter, or a bang before the slash", () => {
    for (const line of FX.priority.notTags) expect(LINE_TAG.exec(line), line).toBeNull();
  });

  it("travel with the state through ⌘⏎", () => {
    for (const { line, after } of FX.priority.rotate) {
      const doc = Text.of([line]);
      expect(applied(line, planRotate(doc, 0, 0)), line).toBe(after);
    }
  });

  it("step up and down with ⌃⌘↑ / ⌃⌘↓, clamped, over the same lines as ⌘⏎", () => {
    for (const c of FX.priority.step) {
      const doc = Text.of(c.doc.split("\n"));
      expect(applied(c.doc, planPriority(doc, c.from, c.to, c.delta)), c.name).toBe(c.after);
    }
  });

  it("travel with the state through a click", () => {
    for (const { line, alt, after } of FX.priority.click) {
      const tag = LINE_TAG.exec(line)!;
      const change = tagChange({ from: 0, text: line }, tag, nextOnClick(norm(tag[2]), alt));
      expect(applied(line, [change]), line).toBe(after);
    }
  });
});

describe("Enter continues a task or a list, and an empty one ends it", () => {
  it("matches the shared cases", () => {
    for (const c of FX.enter.cases) {
      const plan = planEnter(c.line, c.col);
      const label = `${JSON.stringify(c.line)} @${c.col}`;
      expect(plan.kind, label).toBe(c.kind);
      if (plan.kind === "continue") expect(plan.prefix, label).toBe(c.prefix);
      if (plan.kind === "exit") expect([plan.from, plan.to], label).toEqual([c.from, c.to]);
    }
  });
});

// ---- Backspace on a checkbox, and "!" at the start of a task ----------------
// From parker-cursor-bug.md (25/09): after ⌘⏎ the cursor sits after the space;
// Backspace there took only the space, and "!" became text.

describe("planMarkerDelete", () => {
  it("Backspace after the space takes the whole checkbox (Bug 1)", () => {
    expect(planMarkerDelete("/TODO ", 6, true)).toEqual({ from: 0, to: 6 });
    expect(planMarkerDelete("/TODO buy milk", 6, true)).toEqual({ from: 0, to: 6 });
  });

  it("Backspace right after the tag does the same", () => {
    expect(planMarkerDelete("/TODO buy milk", 5, true)).toEqual({ from: 0, to: 6 });
    expect(planMarkerDelete("/TODO", 5, true)).toEqual({ from: 0, to: 5 });
  });

  it("keeps the indentation and takes the bangs with the tag", () => {
    expect(planMarkerDelete("  /TODO nested", 8, true)).toEqual({ from: 2, to: 8 });
    expect(planMarkerDelete("/TODO!!! urgent", 9, true)).toEqual({ from: 0, to: 9 });
    expect(planMarkerDelete("/DONE finished", 6, true)).toEqual({ from: 0, to: 6 });
  });

  it("leaves Backspace alone anywhere else in the line", () => {
    expect(planMarkerDelete("/TODO buy milk", 7, true)).toBeNull(); // inside the text
    expect(planMarkerDelete("/TODO buy milk", 14, true)).toBeNull(); // end of line
    expect(planMarkerDelete("/TODO buy milk", 0, true)).toBeNull(); // before the box
    expect(planMarkerDelete("/TODO  two spaces", 7, true)).toBeNull(); // past the one space
    expect(planMarkerDelete("buy milk", 0, true)).toBeNull(); // not a task
  });

  it("Delete right before the tag takes the checkbox", () => {
    expect(planMarkerDelete("/TODO buy milk", 0, false)).toEqual({ from: 0, to: 6 });
    expect(planMarkerDelete("  /TODO x", 2, false)).toEqual({ from: 2, to: 8 });
    expect(planMarkerDelete("/TODO buy milk", 6, false)).toBeNull();
  });
});

// Tasks and list items behave the same (Manoel, 25/09): the empty bullet that
// Enter leaves goes in one ⌫, like the empty task ⌘⏎ leaves.
describe("planMarkerDelete on list items", () => {
  it("⌫ at the start of an item's text takes the bullet", () => {
    expect(planMarkerDelete("- ", 2, true)).toEqual({ from: 0, to: 2 });
    expect(planMarkerDelete("- item", 2, true)).toEqual({ from: 0, to: 2 });
    expect(planMarkerDelete("* item", 2, true)).toEqual({ from: 0, to: 2 });
    expect(planMarkerDelete("12. item", 4, true)).toEqual({ from: 0, to: 4 });
  });

  it("⌫ right after the bullet does the same", () => {
    expect(planMarkerDelete("- item", 1, true)).toEqual({ from: 0, to: 2 });
  });

  it("keeps the indentation; \"[ ]\" after the bullet is text, not a checkbox", () => {
    expect(planMarkerDelete("  - nested", 4, true)).toEqual({ from: 2, to: 4 });
    expect(planMarkerDelete("- [ ] task", 2, true)).toEqual({ from: 0, to: 2 });
    expect(planMarkerDelete("- [ ] task", 6, true)).toBeNull();
    expect(planMarkerDelete("- [x] done", 6, true)).toBeNull();
  });

  it("leaves Backspace alone inside the text, and on plain lines", () => {
    expect(planMarkerDelete("- item", 4, true)).toBeNull();
    expect(planMarkerDelete("- item", 0, true)).toBeNull();
    expect(planMarkerDelete("-item", 1, true)).toBeNull(); // not a list item
    expect(planMarkerDelete("text", 0, true)).toBeNull();
  });

  it("Delete right before the bullet takes it", () => {
    expect(planMarkerDelete("- item", 0, false)).toEqual({ from: 0, to: 2 });
    expect(planMarkerDelete("  1. one", 2, false)).toEqual({ from: 2, to: 5 });
    expect(planMarkerDelete("- item", 2, false)).toBeNull();
  });
});

describe("planBang", () => {
  it("! at the start of a task's text goes into the tag (Bug 2)", () => {
    expect(planBang("/TODO ", 6)).toBe(5);
    expect(planBang("/TODO buy milk", 6)).toBe(5);
    expect(planBang("/TODO", 5)).toBe(5);
  });

  it("stacks up to !!!", () => {
    expect(planBang("/TODO! x", 7)).toBe(6);
    expect(planBang("/TODO!! x", 8)).toBe(7);
  });

  it("types a fourth ! as text", () => {
    expect(planBang("/TODO!!! x", 9)).toBeNull();
  });

  it("is text anywhere else", () => {
    expect(planBang("/TODO buy milk", 10)).toBeNull();
    expect(planBang("/TODO buy milk", 14)).toBeNull();
    expect(planBang("  /TODO x", 1)).toBeNull();
    expect(planBang("buy milk", 0)).toBeNull();
  });

  it("is text on a list item: lists have no priority", () => {
    expect(planBang("- item", 2)).toBeNull();
  });

  it("works on any state and under indentation", () => {
    expect(planBang("/DOING x", 7)).toBe(6);
    expect(planBang("  /WAIT x", 8)).toBe(7);
  });
});

describe("planLineDelete", () => {
  it("deletes a task's text back to the checkbox", () => {
    expect(planLineDelete("/TODO buy milk", 14)).toEqual({ from: 6, to: 14 });
    expect(planLineDelete("  /TODO!!! buy", 14)).toEqual({ from: 11, to: 14 });
  });
  it("takes the checkbox once the text is gone, keeping the indentation", () => {
    expect(planLineDelete("  /TODO ", 8)).toEqual({ from: 2, to: 8 });
  });
  it("does the same for a list item", () => {
    expect(planLineDelete("- buy milk", 10)).toEqual({ from: 2, to: 10 });
    expect(planLineDelete("  1. x", 6)).toEqual({ from: 5, to: 6 });
    expect(planLineDelete("  - ", 4)).toEqual({ from: 2, to: 4 });
  });
  it("leaves a cursor inside the mark, and plain text, to the editor", () => {
    expect(planLineDelete("/TODO buy", 3)).toBeNull();
    expect(planLineDelete("buy milk", 8)).toBeNull();
  });
});
