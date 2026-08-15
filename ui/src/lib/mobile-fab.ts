/**
 * Bottom offset (from the viewport bottom) for the mobile dashboard edit FAB.
 *
 * The FAB must clear the bottom navigation bar, which is `min-h-[56px]` plus a
 * device safe-area spacer (`env(safe-area-inset-bottom)`). A hardcoded pixel
 * offset ignores that inset, so on notched devices (iOS/Android PWA with a home
 * indicator) the FAB dropped onto the rightmost "Plus"/Settings nav button.
 *
 * Adding the inset keeps a constant ~16px clearance above the nav on every
 * device. See issue #496.
 */
export const MOBILE_FAB_BOTTOM = "calc(72px + env(safe-area-inset-bottom, 0px))";
