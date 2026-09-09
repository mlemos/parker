# To-do visuals

The living visual spec of Parker's to-dos, generated from the real tokens:
the eight states, the box, the Lucide glyphs and their normalisation (with
measurements), the pen sheet, priority marks, everything in context on the Mac
and the iPhone, across all eight themes.

- `measure.py` — measures the glyph paths (arcs sampled) and where the ink
  lands after normalisation → `glyph-bbox.json`, `glyph-measure.json`.
- `gen.py` — builds `parker-todo-visuals.html` from `shared/design-tokens.json`
  and those measurements.

The page is published as an Artifact and is the place where visual decisions
are made and recorded: https://claude.ai/code/artifact/693fb5fc-f1ae-4392-853c-59493c668eb4

Regenerate after a theme or glyph change: `node scripts/export-design-tokens.mjs`,
then `python3 design/todo-visuals/measure.py && python3 design/todo-visuals/gen.py`.
