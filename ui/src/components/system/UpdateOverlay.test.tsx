import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, userEvent, waitFor } from "../../test-utils";
import i18n from "../../i18n";
import { UpdateOverlay } from "./UpdateOverlay";
import { getSystemVersion, type SystemVersionInfo } from "../../api";
import { useWebSocket } from "../../store/useWebSocket";
import { useAuth } from "../../store/useAuth";
import type { User } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getSystemVersion: vi.fn().mockResolvedValue({ current: "1.65.0" }),
}));

function user(role: User["role"]): User {
  return {
    id: "u-1",
    username: role,
    displayName: role,
    role,
    preferences: {} as User["preferences"],
    enabled: true,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

const HELPER_FAILURE =
  'Helper "sowel-updater" exited with code 1 without restarting Sowel — dial tcp 140.82.121.34:443: i/o timeout';

/**
 * A self-update whose helper container dies (registry unreachable, compose
 * refusing) used to leave this overlay up for the life of the process. The
 * engine now reports the failure — these lock what the admin then sees, because
 * an overlay that merely disappears is indistinguishable from one that worked.
 */
describe("UpdateOverlay", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    useWebSocket.setState({ updateInProgress: false, updateFailure: null });
    useAuth.setState({ user: user("admin") });
  });

  it("renders nothing when no update is running", () => {
    const { container } = render(<UpdateOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it("names the reason a failed update stopped", () => {
    useWebSocket.setState({
      updateFailure: { message: HELPER_FAILURE, operation: "update" },
    });
    render(<UpdateOverlay />);

    expect(screen.getByText("Update failed")).toBeTruthy();
    expect(screen.getByText(/i\/o timeout/)).toBeTruthy();
  });

  it("wins over an in-progress flag left behind by the same attempt", () => {
    useWebSocket.setState({
      updateInProgress: true,
      updateFailure: { message: "pull refused", operation: "update" },
    });
    render(<UpdateOverlay />);

    // The spinner would otherwise keep the screen, which is the bug itself.
    expect(screen.getByText("Update failed")).toBeTruthy();
  });

  it("hands the UI back when dismissed", async () => {
    useWebSocket.setState({ updateFailure: { message: "pull refused", operation: "update" } });
    render(<UpdateOverlay />);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(useWebSocket.getState().updateFailure).toBeNull());
    expect(screen.queryByText("Update failed")).toBeNull();
  });

  // A failed restart travels on the same event as a failed update. Telling the
  // user "no new version was installed" after they changed their home location
  // answers a question they did not ask, and hides the one they did.
  it("says a restart failed, not an update", () => {
    useWebSocket.setState({
      updateFailure: {
        message: 'Helper "sowel-restarter" exited with code 1 without restarting Sowel',
        operation: "restart",
      },
    });
    render(<UpdateOverlay />);

    expect(screen.getByText("Restart failed")).toBeTruthy();
    expect(screen.queryByText("Update failed")).toBeNull();
    expect(screen.getByText(/settings are saved/)).toBeTruthy();
  });

  // The server redacts free-form strings for a non-admin client, so this one
  // would otherwise read "[redacted]" across the whole screen.
  it("tells a non-admin it stopped without showing the redacted reason", () => {
    useAuth.setState({ user: user("standard") });
    useWebSocket.setState({
      updateInProgress: true,
      updateFailure: { message: "[redacted]", operation: "update" },
    });
    render(<UpdateOverlay />);

    expect(screen.getByText("Update failed")).toBeTruthy();
    expect(screen.queryByText("[redacted]")).toBeNull();
    // And the in-progress spinner is gone, so the app is usable again.
    expect(screen.queryByText("Update in progress")).toBeNull();
  });
});

/**
 * #1337: on a phone the overlay showed for a blink, then the page reloaded
 * before the update had started, and nothing told the user Sowel was updating.
 * The overlay reloaded whenever the starting version was still unknown, which
 * is what two /system/version answers racing at mount, or a WebSocket
 * reconnecting on wake, produce.
 */
describe("UpdateOverlay reload", () => {
  const reload = vi.fn();
  const version = vi.mocked(getSystemVersion);
  const info = (current: string) => ({ current }) as SystemVersionInfo;
  // A macrotask runs after every pending microtask, so each answered call has
  // reached its reload check by then, however many awaits it goes through.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    reload.mockReset();
    version.mockReset();
    vi.stubGlobal("location", { ...window.location, reload });
    useAuth.setState({ user: user("admin") });
    useWebSocket.setState({
      updateInProgress: true,
      updateFailure: null,
      status: "connected",
      updateAvailable: { current: "1.65.0", latest: "1.66.0", releaseUrl: "" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not reload when the reconnect answer beats the first capture", async () => {
    // The mount capture never answers; the WebSocket effect's call does, with
    // the version still running. That used to reload on the spot.
    version.mockReturnValueOnce(new Promise(() => {})).mockResolvedValue(info("1.65.0"));
    render(<UpdateOverlay />);

    await waitFor(() => expect(version).toHaveBeenCalledTimes(2));
    await settle();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText("Update in progress")).toBeTruthy();
  });

  it("does not reload on a reconnect while the starting version is unknown", async () => {
    useWebSocket.setState({ updateAvailable: null });
    version.mockReturnValueOnce(new Promise(() => {})).mockResolvedValue(info("1.65.0"));
    render(<UpdateOverlay />);

    await waitFor(() => expect(version).toHaveBeenCalledTimes(2));
    await settle();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once the reconnected Sowel runs the new version", async () => {
    version.mockResolvedValue(info("1.65.0"));
    render(<UpdateOverlay />);
    await waitFor(() => expect(version).toHaveBeenCalledTimes(2));
    expect(reload).not.toHaveBeenCalled();

    version.mockResolvedValue(info("1.66.0"));
    // Two renders, as on a real reconnect: one setState pair would batch.
    act(() => useWebSocket.setState({ status: "disconnected" }));
    act(() => useWebSocket.setState({ status: "connected" }));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});
