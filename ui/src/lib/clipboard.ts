/**
 * navigator.clipboard is only available in a "secure context" (HTTPS or
 * localhost) — over plain HTTP (e.g. a LAN dev instance reached by IP) it's
 * `undefined`, and calling `.writeText()` on it throws immediately, which a
 * bare `await navigator.clipboard.writeText(...)` in a click handler swallows
 * as an unhandled rejection: the button silently does nothing. Falls back to
 * the legacy `execCommand("copy")` technique via a hidden textarea.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy technique below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let succeeded = false;
  try {
    succeeded = document.execCommand("copy");
  } catch {
    succeeded = false;
  } finally {
    document.body.removeChild(textarea);
  }
  return succeeded;
}
