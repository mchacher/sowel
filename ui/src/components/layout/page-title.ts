/**
 * Class for the H1 of a top-level page (spec 196, decision pr6-h1): below lg
 * the compact top bar already names the page, so the title is visually hidden
 * there but stays the page's heading for screen readers. Detail pages
 * (equipment, device, zone) keep a visible 22 px title: it names the object.
 */
export const TOP_LEVEL_H1 = "sr-only lg:not-sr-only";
