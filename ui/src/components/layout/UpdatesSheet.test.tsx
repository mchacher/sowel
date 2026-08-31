/**
 * Spec 172 — the top-bar updates panel can finish a personal-source update.
 *
 * The panel offered an Update button for every outdated package, including the
 * ones spec 136 refuses to update without a fresh fingerprint approval. The
 * request came back 409 and the panel printed its raw code, so the only way
 * through was the Plugins page. These pin the flow that replaced that.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "../../test-utils";
import { UpdatesSheet } from "./UpdatesSheet";
import { useWebSocket } from "../../store/useWebSocket";
import * as api from "../../api";
import type { PluginInfo } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getPlugins: vi.fn(),
  updatePlugin: vi.fn(),
  triggerSystemUpdate: vi.fn(),
}));

function pkg(over: Partial<PluginInfo> = {}): PluginInfo {
  return {
    manifest: {
      id: "delivery-gate",
      name: "Delivery Gate",
      version: "0.2.0",
      description: "",
      icon: "Truck",
      type: "recipe",
      author: "adn-dev-adrien",
      repo: "adn-dev-adrien/sowel-recipe-delivery-gate",
    },
    enabled: true,
    installedAt: "2026-08-30T00:00:00.000Z",
    latestVersion: "0.3.0",
    ...over,
  } as PluginInfo;
}

const FINGERPRINT = "203d1da100543f47bb63953098e3c76e3af880e5316b318c66a99d0c4e94f159";

const refused = () =>
  new api.PersonalPluginConfirmationRequiredError(
    "adn-dev-adrien/sowel-recipe-delivery-gate",
    "adn-dev-adrien",
    "0.3.0",
    FINGERPRINT,
  );

/** Render, wait for the list, and click the row's Update button. */
async function clickUpdate() {
  render(<UpdatesSheet open onClose={() => {}} />);
  const button = await screen.findByRole("button", { name: "Update" });
  await act(async () => {
    fireEvent.click(button);
  });
}

beforeEach(() => {
  useWebSocket.setState({ updateAvailable: null });
  vi.mocked(api.getPlugins).mockResolvedValue([pkg({ source: "personal" })]);
  vi.mocked(api.updatePlugin).mockResolvedValue({ success: true });
});
afterEach(() => vi.clearAllMocks());

describe("UpdatesSheet — personal-source confirmation (spec 172)", () => {
  it("asks for the fingerprint instead of printing the refusal", async () => {
    vi.mocked(api.updatePlugin).mockRejectedValueOnce(refused());
    await clickUpdate();

    expect(screen.getByText("Personal plugin")).toBeTruthy();
    expect(screen.getByText("adn-dev-adrien/sowel-recipe-delivery-gate")).toBeTruthy();
    expect(screen.getByText("0.3.0")).toBeTruthy();
    // Truncated on screen, whole value in the title attribute.
    const shown = screen.getByText(`${FINGERPRINT.slice(0, 12)}…`);
    expect(shown.getAttribute("title")).toBe(FINGERPRINT);
    // The raw 409 code must not reach the user as an error.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.updatePlugin).toHaveBeenCalledTimes(1);
  });

  it("retries with the pinned fingerprint once confirmed", async () => {
    vi.mocked(api.updatePlugin).mockRejectedValueOnce(refused());
    await clickUpdate();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Trust and update" }));
    });

    expect(api.updatePlugin).toHaveBeenLastCalledWith("delivery-gate", {
      confirmed: true,
      expectedSha256: FINGERPRINT,
    });
    // The row leaves the list once the backend has had its settling moment.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Update" })).toBeNull(), {
      timeout: 3000,
    });
  });

  it("sends nothing more when the confirmation is dismissed", async () => {
    vi.mocked(api.updatePlugin).mockRejectedValueOnce(refused());
    await clickUpdate();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    expect(api.updatePlugin).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Personal plugin")).toBeNull();
    // And the row is still there, still updatable.
    const retry = screen.getByRole("button", { name: "Update" });
    expect(retry.hasAttribute("disabled")).toBe(false);
  });

  it("marks a personal row, so the extra step is expected", async () => {
    render(<UpdatesSheet open onClose={() => {}} />);
    expect(await screen.findByText("Personal")).toBeTruthy();
  });

  it("updates an ordinary package in one click, with no dialog", async () => {
    vi.mocked(api.getPlugins).mockResolvedValue([pkg()]);
    await clickUpdate();

    expect(api.updatePlugin).toHaveBeenCalledWith("delivery-gate", {});
    expect(screen.queryByText("Personal plugin")).toBeNull();
    expect(screen.queryByText("Personal")).toBeNull();
  });

  it("still surfaces an ordinary failure in the error line", async () => {
    vi.mocked(api.updatePlugin).mockRejectedValueOnce(new Error("Tarball SHA256 mismatch"));
    await clickUpdate();

    expect(screen.getByRole("alert").textContent).toContain("Tarball SHA256 mismatch");
    expect(screen.queryByText("Personal plugin")).toBeNull();
  });
});
