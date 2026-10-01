/**
 * Spec 181 R5.24 — the name and the icon of the visitors' page on a home
 * screen: the image is resized here to the three sizes, the backend only
 * checks them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, userEvent, waitFor } from "../../test-utils";
import { SharedAccessAppSettings } from "./SharedAccessAppSettings";
import * as api from "../../api/sharedAccess";

vi.mock("../../api/sharedAccess", async (orig) => ({
  ...(await orig<typeof import("../../api/sharedAccess")>()),
  getSharedAccessApp: vi.fn(),
  updateSharedAccessApp: vi.fn(),
}));

const DEFAULT_VIEW = { name: "Accès", customIcon: false, version: "v1" };

beforeEach(() => {
  vi.mocked(api.getSharedAccessApp).mockResolvedValue(DEFAULT_VIEW);
  vi.mocked(api.updateSharedAccessApp).mockImplementation(async (body) => ({
    name: body.name || "Accès",
    customIcon: Boolean(body.icons),
    version: "v2",
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe("SharedAccessAppSettings", () => {
  it("shows the default mark and saves a new name alone", async () => {
    render(<SharedAccessAppSettings />);
    const input = await screen.findByLabelText("Name");
    expect(screen.getByRole("img", { name: "Default icon" })).toBeTruthy();
    await userEvent.clear(input);
    await userEvent.type(input, "SOLIO");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateSharedAccessApp).toHaveBeenCalledWith({ name: "SOLIO" }));
    expect(await screen.findByText("✓ Saved.")).toBeTruthy();
  });

  it("resizes a chosen image to 180, 192 and 512 px and sends the three PNGs", async () => {
    const drawn: number[] = [];
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 800;
        naturalHeight = 600;
        onload: (() => void) | null = null;
        set src(_v: string) {
          setTimeout(() => this.onload?.(), 0);
        }
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return { drawImage: () => drawn.push(this.width), imageSmoothingQuality: "low" } as never;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return `data:image/png;base64,PNG${this.width}`;
    });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();

    render(<SharedAccessAppSettings />);
    const file = new File(["x"], "solio.png", { type: "image/png" });
    await userEvent.upload(await screen.findByTestId("sa-app-icon-file"), file);
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.updateSharedAccessApp).toHaveBeenCalledWith({
        name: "Accès",
        icons: { "180": "PNG180", "192": "PNG192", "512": "PNG512" },
      }),
    );
    expect(drawn).toEqual([180, 192, 512]);
  });

  it("offers to return to the default icon, and sends null for it", async () => {
    vi.mocked(api.getSharedAccessApp).mockResolvedValue({ ...DEFAULT_VIEW, customIcon: true });
    render(<SharedAccessAppSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Back to the default icon" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.updateSharedAccessApp).toHaveBeenCalledWith({ name: "Accès", icons: null }),
    );
  });
});
