import { describe, expect, it } from "vitest";
import { ORDER, norm } from "./todo-model.ts";
import { CHILD_DECOS, LINE_DECOS } from "./todo.ts";

// A state with no decoration doesn't fail — it quietly falls through to
// whatever markdown was going to paint, which is how /TODO's nested lines
// ended up wearing the generic list colour. The registries have to be
// complete, and the state machine is what says what complete means.
describe("decoration coverage", () => {
  it("dresses every state's nested lines", () => {
    for (const state of ORDER) expect(CHILD_DECOS[state], state).toBeDefined();
  });

  it("dresses every state's own line, except the origin", () => {
    for (const state of ORDER) {
      if (state === "TODO") continue; // no hue of its own: drawn in body text
      expect(LINE_DECOS[state], state).toBeDefined();
    }
  });

  // LINE_DECOS is looked up with the raw tag, so it carries the aliases too;
  // CHILD_DECOS is looked up with a normalised state and does not. Either way
  // no key may be a state the machine has never heard of.
  it("invents no state the machine doesn't have", () => {
    const known = new Set<string>(ORDER);
    for (const key of [...Object.keys(CHILD_DECOS), ...Object.keys(LINE_DECOS)])
      expect(known.has(norm(key)), key).toBe(true);
  });

  it("dresses the aliases on their own line, since the tag is read raw", () => {
    for (const alias of ["WIP", "PAUSED", "HOLD", "WAITING", "BLOCKED", "MISSED", "DISMISSED"])
      expect(LINE_DECOS[alias], alias).toBeDefined();
  });
});
