import { useEffect, useRef } from "react";
import {
  Compartment,
  EditorState,
  EditorView,
  Prec,
  Transaction,
  getDefaultExtensions,
} from "@uiw/react-codemirror";
import type { Extension } from "@uiw/react-codemirror";
import {
  External,
  changedLines,
  setChangedLines,
} from "../lib/external-change";
import { foldMarkers, folding } from "../lib/fold";
import { selectionGutter } from "../lib/selection-gutter";
import { todoHighlighter, todoKeymap } from "../lib/todo";
import { setActiveView } from "../lib/latency";
import type { ThemeDef } from "../lib/themes";

/**
 * One CodeMirror view per pane, holding one EditorState per tab.
 *
 * The pane used to mount a fresh <CodeMirror> per tab, keyed by filename, so
 * switching tabs destroyed the view and built another. Everything the editor
 * knew about the tab you were leaving — where the cursor was, how far you had
 * scrolled, what ⌘Z would undo — died with it, and came back as a blank
 * document scrolled to the top. That is not how CodeMirror is meant to be
 * driven: an EditorState is a value you can put down and pick up, and the view
 * is the expensive part you keep.
 *
 * So the view is created once and lives as long as the pane. Switching tabs
 * parks the outgoing EditorState in a map and calls setState with the incoming
 * one. Scroll position rides alongside, because it belongs to the DOM rather
 * than to the state.
 *
 * Everything that can change while a tab sits in the background — theme, line
 * wrap, the gutter, the language — lives in a Compartment, and a state coming
 * back out of the map is reconfigured to the current settings before anyone
 * sees it. Otherwise a note you opened before switching themes would return
 * wearing the old one.
 */
export function Editor({
  tab,
  tabs,
  content,
  focused,
  theme,
  gutterOn,
  wrapOn,
  langExt,
  changed,
  onChange,
}: {
  /** Active tab — the document currently in the view. */
  tab: string;
  /** Every tab open in this pane, so closed ones can be dropped from the cache. */
  tabs: string[];
  content: string;
  focused: boolean;
  theme: ThemeDef;
  gutterOn: boolean;
  wrapOn: boolean;
  langExt: Extension[];
  /** Lines (1-based) rewritten by the last reload from disk. */
  changed: number[] | undefined;
  onChange: (name: string, value: string) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  /** Parked state per tab — the point of the whole file. */
  const states = useRef(new Map<string, EditorState>());
  const scroll = useRef(new Map<string, number>());
  /** The tab the view currently holds; not always the prop, mid-switch. */
  const loaded = useRef<string | null>(null);
  /**
   * The last document this pane emitted. Kept so an incoming `content` that is
   * merely our own edit coming back through React can be recognised by
   * reference, without stringifying the document on every keystroke.
   */
  const emitted = useRef<string | null>(null);

  // Props the CodeMirror extensions read. Through refs, so the extensions are
  // built once: an extension that closes over a prop would have to be rebuilt
  // (and the whole editor reconfigured) every time that prop changed.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const contentRef = useRef(content);
  contentRef.current = content;
  const changedRef = useRef(changed);
  changedRef.current = changed;

  const compartments = useRef({
    theme: new Compartment(),
    wrap: new Compartment(),
    gutter: new Compartment(),
    lang: new Compartment(),
  });

  // ---- What goes in each compartment ---------------------------------------

  const themeExt = (t: ThemeDef): Extension => [
    Prec.highest(t.cm),
    EditorView.theme({}, { dark: t.mode === "dark" }),
  ];
  const wrapExt = (on: boolean): Extension => (on ? EditorView.lineWrapping : []);
  // The chevron column rides with the line numbers: one gutter, one switch.
  // Order matters — gutters are laid out in the order their extensions are
  // added, so the numbers come first and the chevrons sit between them and the
  // text, which is where CodeMirror itself puts them.
  const gutterExt = (on: boolean): Extension => [
    getDefaultExtensions({
      basicSetup: {
        lineNumbers: on,
        // Ours (foldMarkers) instead — uiw's would draw its own arrows.
        foldGutter: false,
        // EXPERIMENT (2026-08-25): off, so the browser draws the selection.
        // CodeMirror's version fills the middle lines to the full width of the
        // content; the native one hugs the text and adds a small tail for the
        // line break — the shape VS Code has. The cost is that a native
        // selection can only show one range, so ⌘D's extra matches are edited
        // but not seen. Revert this line to get them back.
        drawSelection: false,
        highlightActiveLine: true,
        highlightActiveLineGutter: on,
        highlightSelectionMatches: false,
        syntaxHighlighting: false,
      },
    }),
    on ? foldMarkers : [],
    on ? selectionGutter : [],
  ];

  const makeState = (doc: string) => {
    const c = compartments.current;
    return EditorState.create({
      doc,
      extensions: [
        c.theme.of(themeExt(theme)),
        c.wrap.of(wrapExt(wrapOn)),
        c.gutter.of(gutterExt(gutterOn)),
        c.lang.of(langExt),
        todoHighlighter,
        todoKeymap,
        folding,
        changedLines,
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          // A reload is not an edit. Reporting it back would mark the buffer
          // dirty, have autosave write the file it just read, and wipe the
          // marks the reload had just put on.
          if (u.transactions.some((tr) => tr.annotation(External))) return;
          const value = u.state.doc.toString();
          emitted.current = value;
          if (loaded.current) onChangeRef.current(loaded.current, value);
        }),
      ],
    });
  };

  /** Bring a state that may have been parked before a settings change up to date. */
  const reconfigure = () => {
    const c = compartments.current;
    return [
      c.theme.reconfigure(themeExt(theme)),
      c.wrap.reconfigure(wrapExt(wrapOn)),
      c.gutter.reconfigure(gutterExt(gutterOn)),
      c.lang.reconfigure(langExt),
    ];
  };

  // ---- Mount ---------------------------------------------------------------

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      state: makeState(contentRef.current),
      parent: host.current,
    });
    view.current = v;
    loaded.current = tab;
    emitted.current = contentRef.current;
    setActiveView(v);
    if (focused) v.focus();
    return () => {
      v.destroy();
      view.current = null;
      loaded.current = null;
      states.current.clear();
      scroll.current.clear();
    };
    // Once per pane. Everything else is driven by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Tab switch ----------------------------------------------------------

  useEffect(() => {
    const v = view.current;
    if (!v || !tab || loaded.current === tab) return;

    if (loaded.current) {
      states.current.set(loaded.current, v.state);
      scroll.current.set(loaded.current, v.scrollDOM.scrollTop);
    }

    // A parked state is only good if the file hasn't changed underneath it —
    // a git pull or another pane may have rewritten the note while this tab
    // sat in the background.
    const parked = states.current.get(tab);
    const fresh = parked && parked.doc.toString() === contentRef.current;
    v.setState(fresh ? parked : makeState(contentRef.current));
    v.dispatch({
      effects: [...reconfigure(), setChangedLines.of(changedRef.current ?? [])],
    });
    v.scrollDOM.scrollTop = fresh ? scroll.current.get(tab) ?? 0 : 0;

    loaded.current = tab;
    emitted.current = contentRef.current;
    if (focused) v.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Drop what a closed (or renamed) tab left behind.
  useEffect(() => {
    const open = new Set(tabs);
    for (const name of states.current.keys())
      if (!open.has(name)) states.current.delete(name);
    for (const name of scroll.current.keys())
      if (!open.has(name)) scroll.current.delete(name);
  }, [tabs]);

  // ---- Content arriving from outside ---------------------------------------
  // A reload from disk, or the same note being edited in another pane. Our own
  // edits come back here too; those are recognised by reference and ignored.

  useEffect(() => {
    const v = view.current;
    if (!v || loaded.current !== tab) return;
    if (content === emitted.current) return;
    const current = v.state.doc.toString();
    if (content === current) {
      emitted.current = content;
      return;
    }
    v.dispatch({
      changes: { from: 0, to: current.length, insert: content },
      // Not something the user typed — a reload from disk or another pane. It
      // must not be reported back as an edit, and must not become a step that
      // ⌘Z walks back into.
      annotations: [External.of(true), Transaction.addToHistory.of(false)],
    });
    emitted.current = content;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, tab]);

  // ---- Marks left by a reload ----------------------------------------------

  useEffect(() => {
    const v = view.current;
    if (!v || loaded.current !== tab) return;
    v.dispatch({ effects: setChangedLines.of(changed ?? []) });
  }, [changed, tab]);

  // ---- Settings ------------------------------------------------------------

  useEffect(() => {
    view.current?.dispatch({
      effects: compartments.current.theme.reconfigure(themeExt(theme)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    view.current?.dispatch({
      effects: compartments.current.wrap.reconfigure(wrapExt(wrapOn)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrapOn]);

  useEffect(() => {
    view.current?.dispatch({
      effects: compartments.current.gutter.reconfigure(gutterExt(gutterOn)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gutterOn]);

  useEffect(() => {
    view.current?.dispatch({
      effects: compartments.current.lang.reconfigure(langExt),
    });
  }, [langExt]);

  useEffect(() => {
    if (focused) view.current?.focus();
  }, [focused]);

  return <div className="cm-host" ref={host} />;
}
