import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "../../test-utils";
import { useShadowMode } from "../../store/useShadowMode";
import { TopBarFrame } from "./TopBarFrame";

// PR #1136 — below lg the top bar is fixed so iOS 26 does not blur it, with a
// spacer holding its place. Under a shadow or takeover banner it stays in the
// flow: fixed at top-0 it would slide under the banner and leave a 56px gap.

function renderFrame() {
  return render(
    <TopBarFrame>
      <header>Grange Neuve</header>
    </TopBarFrame>,
  );
}

describe("TopBarFrame", () => {
  beforeEach(() => {
    useShadowMode.setState({ shadowMode: false, takeoverPending: false });
  });

  it("fixes the bar below lg and holds its place with a spacer", () => {
    renderFrame();
    expect(screen.getByTestId("topbar-frame").className).toContain("max-lg:fixed");
    expect(screen.getByTestId("topbar-spacer").style.height).toContain("var(--spacing-topbar)");
    expect(screen.getByText("Grange Neuve")).toBeTruthy();
  });

  it.each([
    ["shadow", { shadowMode: true }],
    ["takeover", { takeoverPending: true }],
  ])("keeps the bar in the flow under the %s banner", (_, flags) => {
    useShadowMode.setState(flags);
    renderFrame();
    expect(screen.getByTestId("topbar-frame").className).not.toContain("fixed");
    expect(screen.queryByTestId("topbar-spacer")).toBeNull();
  });
});
