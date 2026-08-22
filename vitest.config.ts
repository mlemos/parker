import { defineConfig } from "vitest/config";

// Unit tests for the pure logic in src/lib. No DOM: everything covered here is
// data in, data out — the layout tree, the to-do state machine, the markdown
// renderer, path and theme helpers. Components and CodeMirror wiring are not
// in scope; they need a different harness and are worth adding separately.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
