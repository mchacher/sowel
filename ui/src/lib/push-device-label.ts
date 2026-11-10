// Spec 199 — a default name for a push device, from the user agent it
// subscribed with: device family + browser and version, « iPhone, Safari 27.2 ».
// The OS version is left out on purpose: Safari freezes it at 18_7 on iOS, so
// only the Safari version tells two iPhones' subscriptions apart.

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

/** « iPhone, Safari 27.2 », or null when the user agent says nothing usable. */
export function pushDeviceLabelFromUserAgent(ua: string | undefined): string | null {
  if (!ua) return null;
  const parts = [deviceFamily(ua), browser(ua)].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(", ") : null;
}
