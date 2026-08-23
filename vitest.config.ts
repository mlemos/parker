import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Two kinds of test live here:
//
//   src/lib/*.test.ts    the pure logic — data in, data out, no DOM. These are
//                        the bulk of it and run in plain node.
//   src/**/*.test.tsx    components that own real interaction logic (keyboard
//                        navigation, confirmation steps). They opt into jsdom
//                        with a `@vitest-environment jsdom` docblock, so the
//                        fast majority isn't slowed down by a DOM it never uses.
//
// Not covered here: the CodeMirror wiring, which is tested through EditorState
// and its commands rather than the rendered DOM, and anything that needs the
// Tauri backend — the `api` module is the seam those tests mock.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test-setup.ts"],
    // Call history as well as implementations: a mock that remembers last
    // test's calls turns "was this never called?" into a coin flip.
    clearMocks: true,
    restoreMocks: true,
  },
});
