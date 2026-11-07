import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "../../test-utils";
import i18n from "../../i18n";
import { useWebSocket } from "../../store/useWebSocket";
import { ConnectionStatus } from "./ConnectionStatus";
import { DEGRADED_DELAY_MS } from "../../hooks/useTopBarState";

// Spec 196, FR-6 — the link indicator shows only when the link is degraded:
// no « Connecté » pill and no permanent ping while all is well, and no flash
// during the routine disconnected → connecting → connected cycle.

describe("ConnectionStatus", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("fr");
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    useWebSocket.setState({ status: "disconnected" });
  });

  it("renders nothing while connected", () => {
    useWebSocket.setState({ status: "connected" });
    const { container } = render(<ConnectionStatus />);
    act(() => vi.advanceTimersByTime(DEGRADED_DELAY_MS * 2));
    expect(container.firstChild).toBeNull();
  });

  it("shows « Connexion… » only once the reconnection has lasted 3 s", () => {
    useWebSocket.setState({ status: "connecting" });
    render(<ConnectionStatus />);
    act(() => vi.advanceTimersByTime(DEGRADED_DELAY_MS - 1));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    const indicator = screen.getByRole("status", { name: "Connexion…" });
    expect(indicator.innerHTML).not.toMatch(/animate-/);
  });

  it("names a lost link, and hides again once it is back", () => {
    useWebSocket.setState({ status: "disconnected" });
    render(<ConnectionStatus />);
    act(() => vi.advanceTimersByTime(DEGRADED_DELAY_MS));
    expect(screen.getByRole("status", { name: "Déconnecté" })).toBeTruthy();
    act(() => useWebSocket.setState({ status: "connected" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not show a quick reconnection at all", () => {
    useWebSocket.setState({ status: "disconnected" });
    render(<ConnectionStatus />);
    act(() => vi.advanceTimersByTime(500));
    act(() => useWebSocket.setState({ status: "connecting" }));
    act(() => vi.advanceTimersByTime(500));
    act(() => useWebSocket.setState({ status: "connected" }));
    act(() => vi.advanceTimersByTime(DEGRADED_DELAY_MS * 2));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
