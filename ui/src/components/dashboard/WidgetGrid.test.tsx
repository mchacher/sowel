import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test-utils";
import { PickerOverlay } from "./WidgetGrid";

// #538 — in mobile edit mode every card carries the `animate-jiggle` transform.
// A transformed ancestor becomes the containing block + stacking context for
// its `fixed` descendants, which trapped the icon-picker overlay behind sibling
// cards. The fix portals the mobile overlay to <body> so it escapes that
// subtree. jsdom does not compute CSS stacking, but it does model DOM parentage
// exactly — and DOM parentage is what the fix changes.
describe("PickerOverlay", () => {
  it("portals the mobile overlay out of the (transformed) card subtree", () => {
    render(
      <div data-testid="card" style={{ transform: "rotate(0.7deg)" }}>
        <PickerOverlay mobile onDismiss={() => {}}>
          <div data-testid="picker">content</div>
        </PickerOverlay>
      </div>,
    );

    const card = screen.getByTestId("card");
    const picker = screen.getByTestId("picker");

    // Rendered, but NOT a descendant of the transformed card — it escaped to body.
    expect(picker).toBeTruthy();
    expect(card.contains(picker)).toBe(false);
    expect(document.body.contains(picker)).toBe(true);
  });

  it("renders a full-screen backdrop on mobile", () => {
    const onDismiss = vi.fn();
    render(
      <PickerOverlay mobile onDismiss={onDismiss}>
        <div data-testid="picker">content</div>
      </PickerOverlay>,
    );

    // The backdrop is a fixed inset-0 sibling of the picker; clicking it dismisses.
    const backdrop = document.querySelector(".fixed.inset-0.bg-black\\/20");
    expect(backdrop).not.toBeNull();
    (backdrop as HTMLElement).click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps the desktop popover inline (anchored under its trigger, no portal)", () => {
    render(
      <div data-testid="card">
        <PickerOverlay mobile={false} onDismiss={() => {}}>
          <div data-testid="picker">content</div>
        </PickerOverlay>
      </div>,
    );

    const card = screen.getByTestId("card");
    const picker = screen.getByTestId("picker");

    // Desktop stays in place — the anchored popover must not escape the card.
    expect(card.contains(picker)).toBe(true);
    // And no full-screen backdrop on desktop.
    expect(document.querySelector(".fixed.inset-0.bg-black\\/20")).toBeNull();
  });
});
