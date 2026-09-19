// A file size as a badge: Empty, 12B, 3KB, 1.2MB. The unit hugs the number so
// it reads as one token — the "open" badge next to it is a word, this is a
// figure. Decimal units, as the Finder counts.

/** Below this many bytes the badge says KB; from here on, MB. It is where a
 *  KB figure would round to "1000KB", which is a megabyte pretending. */
const MB_FROM = 999_500;

export function fmtSize(bytes: number): string {
  if (bytes <= 0) return "Empty";
  if (bytes < 1000) return `${bytes}B`;
  if (bytes < MB_FROM) return `${Math.round(bytes / 1000)}KB`;
  return `${(bytes / 1_000_000).toFixed(1)}MB`;
}
