/** Where a tab strip should scroll to so the given tab is fully in view, or
 *  null when it already is. Offsets are relative to the strip's content (as
 *  `offsetLeft` gives them); `margin` keeps a little of the strip beyond the
 *  tab showing, so a tab at an edge never reads as clipped. A tab wider than
 *  the strip shows its start — that is where its name is. */
export function tabScrollTarget(
  scrollLeft: number,
  viewWidth: number,
  tabLeft: number,
  tabWidth: number,
  margin = 8
): number | null {
  const start = Math.max(0, tabLeft - margin);
  const end = tabLeft + tabWidth + margin;
  if (start >= scrollLeft && end <= scrollLeft + viewWidth) return null;
  if (end - start > viewWidth || start < scrollLeft) return start;
  return end - viewWidth;
}
