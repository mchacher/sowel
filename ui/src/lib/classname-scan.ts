// Used by the tests that scan ui/src for class names (shapes, colour roles):
// a className spread over several lines (a template literal with a ternary)
// has to be read whole, or a rule that needs two classes together misses it.

/** The className value that starts at `at` (the index of `className=`): a string, or the expression in braces. */
export function classNameAt(src: string, at: number): string | null {
  const open = at + "className=".length;
  if (src[open] === '"') return src.slice(open + 1, src.indexOf('"', open + 1));
  if (src[open] !== "{") return null;
  let depth = 0;
  for (let q = open; q < src.length; q++) {
    if (src[q] === "{") depth++;
    else if (src[q] === "}" && --depth === 0) return src.slice(open + 1, q);
  }
  return null;
}

/** Every className value of a source file, with the line it starts on. */
export function classNames(src: string): { line: number; cls: string }[] {
  return [...src.matchAll(/className=/g)].flatMap((m) => {
    const cls = classNameAt(src, m.index);
    return cls === null ? [] : [{ line: src.slice(0, m.index).split("\n").length, cls }];
  });
}

/** The className of the JSX tag whose name ends at `from`, or null when the tag has none. */
export function classNameOfTag(src: string, from: number): string | null {
  const tagEnd = src.slice(from).search(/<[A-Za-z]|[^=]\/?>/);
  const at = src.indexOf("className=", from);
  if (at < 0 || (tagEnd >= 0 && at > from + tagEnd)) return null;
  return classNameAt(src, at);
}
