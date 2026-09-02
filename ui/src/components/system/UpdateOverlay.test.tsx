import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "../../test-utils";
import i18n from "../../i18n";
import { UpdateOverlay } from "./UpdateOverlay";
import { useWebSocket } from "../../store/useWebSocket";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getSystemVersion: vi.fn().mockResolvedValue({ current: "1.65.0" }),
}));

/**
 * A self-update whose helper container dies (registry unreachable, compose
 * refusing) used to leave this overlay up for the life of the process. The
 * engine now reports the failure — these lock what the admin then sees, because
 * an overlay that merely disappears is indistinguishable from one that worked.
 */
describe("UpdateOverlay", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    useWebSocket.setState({ updateInProgress: false, updateError: null });
  });

  it("renders nothing when no update is running", () => {
    const { container } = render(<UpdateOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it("names the reason a failed update stopped", () => {
    useWebSocket.setState({
      updateError:
        'Helper "sowel-updater" exited with code 1 without restarting Sowel — dial tcp 140.82.121.34:443: i/o timeout',
    });
    render(<UpdateOverlay />);

    expect(screen.getByText("Update failed")).toBeTruthy();
    expect(screen.getByText(/i\/o timeout/)).toBeTruthy();
  });

  it("wins over an in-progress flag left behind by the same attempt", () => {
    useWebSocket.setState({ updateInProgress: true, updateError: "pull refused" });
    render(<UpdateOverlay />);

    // The spinner would otherwise keep the screen, which is the bug itself.
    expect(screen.getByText("Update failed")).toBeTruthy();
  });

  it("hands the UI back when dismissed", async () => {
    useWebSocket.setState({ updateError: "pull refused" });
    render(<UpdateOverlay />);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(useWebSocket.getState().updateError).toBeNull());
    expect(screen.queryByText("Update failed")).toBeNull();
  });
});
