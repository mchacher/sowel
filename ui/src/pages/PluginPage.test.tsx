import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen, waitFor } from "../test-utils";
import { PluginPage } from "./PluginPage";
import * as api from "../api";
import * as loader from "./pluginModuleLoader";
import type { PluginPageContext } from "./PluginPage";

vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  getPluginPages: vi.fn(),
}));
vi.mock("./pluginModuleLoader", () => ({ loadPluginModule: vi.fn() }));

/**
 * Spec 180 — the page hosts code Sowel did not build, so what is pinned here
 * is what happens when that code is absent, wrong or broken: the SPA says so
 * and stays navigable.
 */

const page = {
  pluginId: "guest-access",
  label: "Accès invités",
  icon: "DoorOpen",
  placement: "admin" as const,
  entryUrl: "/plugin-ui/guest-access/ui/panel.js?v=1.0.0",
};

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/plugins/guest-access/page"]}>
      <Routes>
        <Route path="/plugins/:pluginId/page" element={<PluginPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.getPluginPages).mockResolvedValue([page]);
});

describe("PluginPage", () => {
  it("imports the declared entry and mounts it in the page", async () => {
    const mount = vi.fn();
    vi.mocked(loader.loadPluginModule).mockResolvedValue({ mount });
    renderPage();

    await waitFor(() => expect(mount).toHaveBeenCalled());
    expect(vi.mocked(loader.loadPluginModule)).toHaveBeenCalledWith(page.entryUrl);
    const [container] = mount.mock.calls[0] as [HTMLElement, PluginPageContext];
    expect(container).toBeInstanceOf(HTMLElement);
  });

  it("hands the plugin an api() bound to its own tree, and refuses a stray path", async () => {
    const mount = vi.fn();
    vi.mocked(loader.loadPluginModule).mockResolvedValue({ mount });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    renderPage();
    await waitFor(() => expect(mount).toHaveBeenCalled());

    const ctx = (mount.mock.calls[0] as [HTMLElement, PluginPageContext])[1];
    await ctx.api("/accesses");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/plugins/guest-access/page/accesses");
    await expect(ctx.api("accesses")).rejects.toThrow(/must start/);
    fetchMock.mockRestore();
  });

  it("says so when no installed plugin offers that page", async () => {
    vi.mocked(api.getPluginPages).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/guest-access/)).toBeTruthy();
    expect(vi.mocked(loader.loadPluginModule)).not.toHaveBeenCalled();
  });

  it("says so when the module exports no mount()", async () => {
    vi.mocked(loader.loadPluginModule).mockResolvedValue({});
    renderPage();
    expect(await screen.findByText(/Accès invités/)).toBeTruthy();
    expect(await screen.findByText("mount()")).toBeTruthy();
  });

  it("says so when the module fails to load, and names the reason", async () => {
    vi.mocked(loader.loadPluginModule).mockRejectedValue(new Error("404 Not Found"));
    renderPage();
    expect(await screen.findByText("404 Not Found")).toBeTruthy();
  });

  it("calls unmount() and empties the container when leaving", async () => {
    const unmount = vi.fn();
    const mount = vi.fn((container: HTMLElement) => {
      container.appendChild(document.createElement("p"));
    });
    vi.mocked(loader.loadPluginModule).mockResolvedValue({ mount, unmount });
    const { unmount: unmountTree } = render(
      <MemoryRouter initialEntries={["/plugins/guest-access/page"]}>
        <Routes>
          <Route path="/plugins/:pluginId/page" element={<PluginPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(mount).toHaveBeenCalled());
    const container = mount.mock.calls[0][0];
    expect(container.childElementCount).toBe(1);

    unmountTree();
    expect(unmount).toHaveBeenCalledWith(container);
    expect(container.childElementCount).toBe(0);
  });
});
