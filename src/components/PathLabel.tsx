import { splitPath } from "../lib/external";
import { prettyPath } from "../lib/path";

/** A file path on one line, however narrow the line. The head gives way to an
 *  ellipsis; the folder and file at the end are never cut. The full path is
 *  on the tooltip. */
export function PathLabel({
  path,
  home,
  className,
}: {
  path: string;
  home: string;
  className?: string;
}) {
  const pretty = prettyPath(path, home);
  const { head, tail } = splitPath(pretty);
  return (
    <span className={"pathlabel" + (className ? " " + className : "")} title={path}>
      {head && <span className="pathlabel-head">{head}</span>}
      <span className="pathlabel-tail">{tail}</span>
    </span>
  );
}
