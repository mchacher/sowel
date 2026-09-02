import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "../../test-utils";
import i18n from "../../i18n";
import { UpdateOverlay } from "./UpdateOverlay";
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
    expect(screen.getByText(/settings were saved/)).toBeTruthy();
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
