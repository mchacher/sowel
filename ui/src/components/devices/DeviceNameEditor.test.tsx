import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import i18n from "../../i18n";
import { ApiError } from "../../api/client";
import { DeviceNameEditor } from "./DeviceNameEditor";

// Issue #1124 — a failed rename used to show the store's English « Failed to update
// device name », whatever the failure. The editor now words the original error.

async function renameTo(onSave: (name: string) => Promise<void>) {
  const user = userEvent.setup();
  render(<DeviceNameEditor name="Old" onSave={onSave} />);
  await user.click(screen.getByTitle("Modifier le nom"));
  const input = screen.getByRole("textbox");
  await user.clear(input);
  await user.type(input, "New{Enter}");
}

describe("DeviceNameEditor failure (#1124)", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("calls a 429 a busy server, in French", async () => {
    await i18n.changeLanguage("fr");
    await renameTo(vi.fn().mockRejectedValue(new ApiError(429, "Too Many Requests")));
    expect(
      await screen.findByText("Trop de demandes en peu de temps. Réessayez dans quelques secondes."),
    ).toBeTruthy();
  });

  it("keeps the server's message for a refused name", async () => {
    await i18n.changeLanguage("fr");
    await renameTo(vi.fn().mockRejectedValue(new ApiError(400, "Name is required")));
    expect(await screen.findByText("Name is required")).toBeTruthy();
  });

  it("falls back to the translated save failure", async () => {
    await i18n.changeLanguage("fr");
    await renameTo(vi.fn().mockRejectedValue(new TypeError("Cannot read properties of undefined")));
    expect(await screen.findByText("Échec de la sauvegarde")).toBeTruthy();
  });
});
