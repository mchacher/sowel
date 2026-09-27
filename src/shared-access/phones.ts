import { createHash } from "node:crypto";
import { CODE_ALPHABET } from "./codes.js";

// ============================================================
// Spec 181 R5.23 — how the owner tells one phone from another.
//
// Nothing is asked of the visitor: the phone is named by what its browser says
// it runs on and by a short tag drawn from its id, « iPhone · 7K3F ». The tag
// derives from the id, so it needs no column and still reads the same in the
// journal after the phone was cut.
// ============================================================

export type PhonePlatform = "iphone" | "ipad" | "android" | "mac" | "windows" | "other";

/** The family the user agent names. An iPhone never says which model it is. */
export function phonePlatform(userAgent: string): PhonePlatform {
  if (/iPhone|iPod/i.test(userAgent)) return "iphone";
  if (/iPad/i.test(userAgent)) return "ipad";
  if (/Android/i.test(userAgent)) return "android";
  // iPadOS asks for the desktop site and reports a Mac.
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "mac";
  if (/Windows/i.test(userAgent)) return "windows";
  return "other";
}

const TAG_LENGTH = 4;

/** Four characters of Crockford base32, stable for a phone id. */
export function phoneTag(phoneId: string): string {
  const digest = createHash("sha256").update(phoneId).digest();
  let out = "";
  for (let i = 0; i < TAG_LENGTH; i++) out += CODE_ALPHABET[digest[i] % CODE_ALPHABET.length];
  return out;
}
