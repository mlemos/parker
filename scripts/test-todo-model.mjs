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
import {
  LINE_TAG,
  ORDER,
  cursorAfterRotate,
  nextInRotation,
  nextOnClick,
  norm,
  planRotate,
} from "../src/lib/todo-model.ts";

const DOCS = {
  "no trailing newline": "# list\n\n\nfirst\nsecond\nthird",
  "trailing newline": "# list\n\n\nfirst\nsecond\nthird\n",
  "already tagged":
    "/TODO first\n/DOING second\n/PAUSE third\n/WAIT fourth\n/ATTN fifth\n/DONE sixth",
  "indented": "  buy milk\n    call bank\nship",
};

// ---- State machine -------------------------------------------------------
// Every state must be reachable and every cycle must close, or a state becomes
// a trap the user can only leave by editing the raw text.
const stateFailures = [];
const check = (what, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want))
    stateFailures.push(`${what} — want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

// Aliases normalize, and every canonical state survives normalization.
for (const [alias, canonical] of [
  ["WIP", "DOING"],
  ["PAUSED", "PAUSE"],
  ["HOLD", "PAUSE"],
  ["WAITING", "WAIT"],
  ["BLOCKED", "WAIT"],
  ["MISSED", "FAIL"],
  ["DISMISSED", "CANCEL"],
])
  check(`norm(${alias})`, norm(alias), canonical);
for (const st of ORDER) check(`norm(${st})`, norm(st), st);

// The tag grammar recognizes every state and alias, and nothing adjacent.
for (const tag of [
  ...ORDER,
  "WIP",
  "PAUSED",
  "HOLD",
  "WAITING",
  "BLOCKED",
  "MISSED",
  "DISMISSED",
]) {
  const m = LINE_TAG.exec(`/${tag} something`);
  check(`LINE_TAG /${tag}`, m && m[2], tag);
}
for (const notATag of [
  "/WAITER x",
  "/PAUSES x",
  "/HOLDING x",
  "/DO x",
  "/TODOS x",
  "TODO x",
  "x /TODO",
])
  check(`LINE_TAG rejects ${notATag}`, LINE_TAG.exec(notATag), null);

// ⌘⏎ walks the whole order once and then clears the tag — no state skipped,
// no loop that never lets go.
const walk = [];
for (let st = ORDER[0]; st !== null; st = nextInRotation(st)) walk.push(st);
check("⌘⏎ rotation", walk, [...ORDER]);

// Plain click: every open state completes, every closed state reopens.
for (const st of ["TODO", "DOING", "PAUSE", "WAIT", "ATTN"])
  check(`click ${st}`, nextOnClick(st, false), "DONE");
for (const st of ["DONE", "FAIL", "CANCEL"])
  check(`click ${st}`, nextOnClick(st, false), "TODO");

// ⌥-click cycles the open states and returns to where it started.
const cycle = [];
let cur = "TODO";
do {
  cycle.push(cur);
  cur = nextOnClick(cur, true);
} while (cur !== "TODO" && cycle.length <= ORDER.length + 1);
check("⌥-click cycle", cycle, [
  "TODO",
  "DOING",
  "PAUSE",
  "WAIT",
  "ATTN",
  "FAIL",
  "CANCEL",
]);
check("⌥-click on DONE", nextOnClick("DONE", true), "ATTN");

for (const f of stateFailures) console.log(`✗ ${f}`);
if (stateFailures.length) process.exitCode = 1;
console.log(`state machine: ${stateFailures.length ? stateFailures.length + " wrong" : "OK"}`);

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
// A state-machine failure must not be masked by a clean selection sweep.
process.exit(failures.length || stateFailures.length ? 1 : 0);
