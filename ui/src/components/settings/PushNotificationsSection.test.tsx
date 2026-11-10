import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import { PushNotificationsSection } from "./PushNotificationsSection";
import { usePushSubscription, type PushStatus } from "../../hooks/usePushSubscription";

vi.mock("../../hooks/usePushSubscription", () => ({
  usePushSubscription: vi.fn(),
}));

const mockedHook = vi.mocked(usePushSubscription);
const subscribe = vi.fn(async () => {});
const unsubscribe = vi.fn(async () => {});

function withStatus(status: PushStatus, over: { busy?: boolean; error?: string | null } = {}) {
  mockedHook.mockReturnValue({
    status,
    supported: status !== "unsupported",
    busy: over.busy ?? false,
    error: over.error ?? null,
    subscribe,
    unsubscribe,
    refresh: vi.fn(async () => {}),
  });
}

describe("PushNotificationsSection (#1199)", () => {
  beforeEach(() => {
    subscribe.mockClear();
    unsubscribe.mockClear();
  });

  it("offers Enable when push is off, and subscribes on tap", async () => {
    withStatus("default");
    render(<PushNotificationsSection />);
    expect(screen.getByText("This device")).toBeTruthy();
    expect(screen.getByText("Push is off for this device.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(subscribe).toHaveBeenCalledOnce();
  });

  it("offers Enable when permission is granted but nothing is subscribed", () => {
    withStatus("granted");
    render(<PushNotificationsSection />);
    expect(screen.getByRole("button", { name: "Enable" })).toBeTruthy();
  });

  it("offers Disable when subscribed, and unsubscribes on tap", async () => {
    withStatus("subscribed");
    render(<PushNotificationsSection />);
    expect(screen.getByText("Push is on for this device.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("shows no button when denied, only how to allow it in the settings", () => {
    withStatus("denied");
    render(<PushNotificationsSection />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Notifications are blocked/)).toBeTruthy();
  });

  it("explains an unsupported browser without a button", () => {
    withStatus("unsupported");
    render(<PushNotificationsSection />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/does not support push/)).toBeTruthy();
  });

  it("explains an insecure context without a button", () => {
    withStatus("insecure");
    render(<PushNotificationsSection />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/secure \(HTTPS\)/)).toBeTruthy();
  });

  it("disables the button while busy and shows an error", () => {
    withStatus("default", { busy: true, error: "boom" });
    render(<PushNotificationsSection />);
    expect((screen.getByRole("button", { name: "Enable" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText("boom")).toBeTruthy();
  });
});
