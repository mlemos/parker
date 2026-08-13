// Regression test for the to-do selection rules (src/lib/todo-model.ts).
//
//   node --experimental-strip-types scripts/test-todo-model.mjs
//
// It brute-forces every possible selection over a few document shapes and
// checks which lines ⌘⏎ would touch against the editor convention: the lines
// a selection covers, minus a trailing line the selection only touches at
// column 0, minus blank lines when several lines are selected. This is how the
// "tag lands on the line below" bug was found — selections ending at the start
// of the next line used to act on that next line.
import { Text } from "@codemirror/state";
import { cursorAfterRotate, planRotate } from "../src/lib/todo-model.ts";

const DOCS = {
  "no trailing newline": "# list\n\n\nfirst\nsecond\nthird",
  "trailing newline": "# list\n\n\nfirst\nsecond\nthird\n",
  "already tagged": "/TODO first\n/ATTN second\n/DONE third",
  "indented": "  buy milk\n    call bank\nship",
};

function expected(doc, from, to) {
  const start = doc.lineAt(from);
  let end = doc.lineAt(to);
  const multi = end.number > start.number;
  if (multi && to === end.from) end = doc.lineAt(to - 1);
  const out = [];
  for (let n = start.number; n <= end.number; n++) {
    const line = doc.line(n);
    if (end.number > start.number && !line.text.trim()) continue;
    out.push(n);
  }
  return out;
}

// Where the cursor lands after ⌘⏎ — it must never sit in front of the tag it
// just created, or the next keystroke lands outside it.
const cursorCases = [
  ["empty line, cursor at start", "", 0, 6],
  ["existing text, cursor at start", "buy milk", 0, 6],
  ["existing text, cursor mid-word", "buy milk", 5, 11],
];
for (const [name, text, head, want] of cursorCases) {
  const doc = Text.of([text]);
  const got = cursorAfterRotate(planRotate(doc, head, head), head);
  if (got !== want) {
    console.log(`✗ cursor: ${name} — want ${want}, got ${got}`);
    process.exitCode = 1;
  }
}
console.log(`cursor placement: ${cursorCases.length} cases checked`);

let checked = 0;
const failures = [];
for (const [name, str] of Object.entries(DOCS)) {
  const doc = Text.of(str.split("\n"));
  for (let from = 0; from <= doc.length; from++) {
    for (let to = from; to <= doc.length; to++) {
      checked++;
      const got = [
        ...new Set(planRotate(doc, from, to).map((c) => doc.lineAt(c.from).number)),
      ];
      const want = expected(doc, from, to);
      if (JSON.stringify(got) !== JSON.stringify(want))
        failures.push({ name, from, to, want, got });
    }
  }
}

for (const f of failures.slice(0, 10))
  console.log(`✗ ${f.name} [${f.from},${f.to}] want ${JSON.stringify(f.want)} got ${JSON.stringify(f.got)}`);
console.log(
  failures.length
    ? `\n${failures.length} of ${checked} selections wrong`
    : `all ${checked} selections OK`
);
process.exit(failures.length ? 1 : 0);
