import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import i18n from "../../i18n";
import { PluginDetailSheet, type PluginDetailSheetProps } from "./PluginDetailSheet";

// Issue #749 — the actions moved off the list row and into this surface.

function props(over: Partial<PluginDetailSheetProps> = {}): PluginDetailSheetProps {
  return {
    open: true,
    onClose: vi.fn(),
    name: "Solar water heater",
    description: "Heats the tank on the solar surplus.",
    icon: <span data-testid="icon" />,
    type: "recipe",
    installedVersion: "0.1.2",
    latestVersion: "0.2.0",
    author: "mchacher",
    source: "registry",
    enabled: true,
    actionLoading: null,
    confirmUninstall: false,
    onUpdate: vi.fn(),
    onToggle: vi.fn(),
    onUninstall: vi.fn(),
    ...over,
  };
}

/** Report the mobile breakpoint to `useIsMobile` (max-width: 639px). */
function setMobile(matches: boolean) {
  window.matchMedia = (query: string) =>
    ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

describe("PluginDetailSheet (#749)", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.clearAllMocks();
    void i18n.changeLanguage("en");
    setMobile(false);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("renders nothing while closed", () => {
    render(<PluginDetailSheet {...props({ open: false })} />);
    expect(screen.queryByText("Solar water heater")).toBeNull();
  });

  it("shows the identity the row no longer has room for", () => {
    render(<PluginDetailSheet {...props()} />);

    expect(screen.getByText("Heats the tank on the solar surplus.")).toBeTruthy();
    expect(screen.getByText("0.1.2")).toBeTruthy();
    expect(screen.getByText("0.2.0")).toBeTruthy();
    expect(screen.getByText("mchacher")).toBeTruthy();
    expect(screen.getByText("Official registry")).toBeTruthy();
  });

  it("names the target version on the update button", () => {
    render(<PluginDetailSheet {...props()} />);
    expect(screen.getByRole("button", { name: "Update to 0.2.0" })).toBeTruthy();
  });

  it("offers no update button when the plugin is up to date", () => {
    render(<PluginDetailSheet {...props({ latestVersion: undefined })} />);
    expect(screen.queryByRole("button", { name: /Update to/ })).toBeNull();
  });

  it("reports a personal source distinctly from the registry (spec 136)", () => {
    render(<PluginDetailSheet {...props({ source: "personal" })} />);
    expect(screen.getByText("Personal source")).toBeTruthy();
    expect(screen.queryByText("Official registry")).toBeNull();
  });

  it("shows integration runtime facts, and hides them for a recipe", () => {
    const { unmount } = render(
      <PluginDetailSheet
        {...props({
          type: "integration",
          status: "connected",
          deviceCount: 42,
          offlineDeviceCount: 1,
        })}
      />,
    );
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("42 (1 offline)")).toBeTruthy();
    unmount();

    render(<PluginDetailSheet {...props()} />);
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("wires update, toggle and uninstall", async () => {
    const p = props();
    render(<PluginDetailSheet {...p} />);

    await userEvent.click(screen.getByRole("button", { name: "Update to 0.2.0" }));
    await userEvent.click(screen.getByRole("button", { name: "Disable" }));
    await userEvent.click(screen.getByRole("button", { name: "Uninstall" }));

    expect(p.onUpdate).toHaveBeenCalledTimes(1);
    expect(p.onToggle).toHaveBeenCalledTimes(1);
    expect(p.onUninstall).toHaveBeenCalledTimes(1);
  });

  it("asks to confirm an uninstall, and says so louder when the plugin is running", () => {
    const { unmount } = render(<PluginDetailSheet {...props({ confirmUninstall: true })} />);
    expect(screen.getByRole("button", { name: "Stop and uninstall?" })).toBeTruthy();
    unmount();

    render(<PluginDetailSheet {...props({ confirmUninstall: true, enabled: false })} />);
    expect(screen.getByRole("button", { name: "Confirm?" })).toBeTruthy();
  });

  it("disables every action while one is in flight", () => {
    render(<PluginDetailSheet {...props({ actionLoading: "update" })} />);
    for (const name of [/Update to/, /Disable/, /Uninstall/]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("is a drawer on desktop and a bottom sheet on mobile", () => {
    const { unmount } = render(<PluginDetailSheet {...props()} />);
    expect(screen.getByRole("dialog", { name: "Solar water heater" })).toBeTruthy();
    unmount();

    setMobile(true);
    render(<PluginDetailSheet {...props()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Solar water heater")).toBeTruthy();
  });
});
