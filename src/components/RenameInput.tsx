import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Inline editor shown in place of a tab's name while renaming.
// Enter (or blur) commits; Escape cancels. The base name (before the
// extension) is pre-selected so you can retype quickly.
export function RenameInput({
  initial,
  onCommit,
  onCancel,
  hint,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  /** Said under the field while it is open (a rename that acts on a link). */
  hint?: string;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!hint || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setAt({ top: r.bottom + 6, left: r.left });
  }, [hint]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(value.trim());
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  return (
    <>
    <input
      ref={ref}
      className="tab-rename"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation(); // don't let the global shortcut handler see this
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={commit}
    />
    {hint && (
      <span className="tab-rename-hint" role="note" style={at ?? undefined}>
        {hint}
      </span>
    )}
    </>
  );
}
