// Spec 199 — a default name for a push device, from the user agent it
// subscribed with: device family + browser and version, « Android, Chrome 130 ».
//
// iPhone and iPad are named by iOS version instead, « iPhone, iOS 27.2 »: push
// only works there from a Sowel added to the home screen, and that app always
// reports Safari's user agent whichever browser added it (Chrome included), so
// naming the browser would be wrong. The OS in that user agent is frozen at
// 18_7; since iOS 26 its `Version/` is the iOS version.

function deviceFamily(ua: string): string | null {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

function browser(ua: string): string | null {
  const major = (re: RegExp) => ua.match(re)?.[1];
  let v: string | undefined;
  if ((v = major(/Edg(?:A|iOS)?\/(\d+)/))) return `Edge ${v}`;
  if ((v = major(/(?:Firefox|FxiOS)\/(\d+)/))) return `Firefox ${v}`;
  if ((v = major(/SamsungBrowser\/(\d+)/))) return `Samsung Internet ${v}`;
  if ((v = major(/(?:Chrome|CriOS)\/(\d+)/))) return `Chrome ${v}`;
  if ((v = major(/Version\/([\d.]+).*Safari/))) return `Safari ${v}`;
  if (/Safari/.test(ua)) return "Safari";
  return null;
}

function iosVersion(ua: string): string | null {
  const v = ua.match(/Version\/([\d.]+)/)?.[1];
  return v ? `iOS ${v}` : null;
}

/** « iPhone, iOS 27.2 », « Android, Chrome 130 », or null when the user agent says nothing usable. */
export function pushDeviceLabelFromUserAgent(ua: string | undefined): string | null {
  if (!ua) return null;
  const family = deviceFamily(ua);
  const second = family === "iPhone" || family === "iPad" ? iosVersion(ua) : browser(ua);
  const parts = [family, second].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(", ") : null;
}
