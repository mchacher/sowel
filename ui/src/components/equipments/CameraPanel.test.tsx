import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, userEvent, waitFor } from "../../test-utils";
import type { DataBindingWithValue } from "../../types";

// #1187 — hls.js left the first load: it is imported when a live view starts
// (a static import is rejected by the lint rule, see lib/bundle-lint.test.ts).
// The live view must behave as before: auth header on every request, the
// error and retry affordance for a browser hls.js does not support.

const hls = vi.hoisted(() => ({
  supportChecks: 0,
  supported: true,
  instances: [] as {
    config: { xhrSetup?: (xhr: { setRequestHeader: (k: string, v: string) => void }) => void };
    source?: string;
    destroyed: boolean;
  }[],
}));

vi.mock("hls.js", () => {
  class FakeHls {
    static Events = { ERROR: "hlsError" };
    static isSupported() {
      hls.supportChecks += 1;
      return hls.supported;
    }
    rec: (typeof hls.instances)[number];
    constructor(config: (typeof hls.instances)[number]["config"]) {
      this.rec = { config, destroyed: false };
      hls.instances.push(this.rec);
    }
    on() {}
    loadSource(url: string) {
      this.rec.source = url;
    }
    attachMedia() {}
    destroy() {
      this.rec.destroyed = true;
    }
  }
  return { default: FakeHls };
});

vi.mock("../../api", () => ({
  getAccessToken: () => "tok-123",
  getCameraStreamUrl: (id: string) => `/api/v1/equipments/${id}/camera/stream.m3u8`,
}));

vi.mock("../../hooks/useCameraSnapshot", () => ({
  useCameraSnapshot: () => ({ url: null, error: false, refresh: () => {} }),
}));

import { CameraPanel } from "./CameraPanel";

const streamBinding = {
  alias: "stream",
  category: "camera_stream_url",
  value: "rtsp://cam",
} as unknown as DataBindingWithValue;

function renderPanel() {
  return render(
    <CameraPanel
      dataBindings={[streamBinding]}
      orderBindings={[]}
      equipmentId="eq-1"
      onExecuteOrder={async () => {}}
    />,
  );
}

describe("CameraPanel live view (hls.js on demand)", () => {
  beforeEach(() => {
    hls.supported = true;
    hls.supportChecks = 0;
    hls.instances.length = 0;
  });

  it("does not load hls.js until the live view starts, then streams with the auth header", async () => {
    renderPanel();
    await act(async () => {});
    expect(hls.supportChecks).toBe(0);

    await userEvent.click(screen.getByRole("button", { name: "Live view" }));

    await waitFor(() => expect(hls.instances).toHaveLength(1));
    expect(hls.supportChecks).toBe(1);
    const [instance] = hls.instances;
    expect(instance.source).toBe("/api/v1/equipments/eq-1/camera/stream.m3u8");
    const headers: Record<string, string> = {};
    instance.config.xhrSetup?.({ setRequestHeader: (k, v) => void (headers[k] = v) });
    expect(headers).toEqual({ Authorization: "Bearer tok-123" });

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(instance.destroyed).toBe(true);
  });

  it("shows the error and retry affordance on a browser hls.js does not support", async () => {
    hls.supported = false;
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Live view" }));
    expect(await screen.findByText("Live view unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(hls.instances).toHaveLength(0);
  });

  it("creates no player when the live view stops before hls.js arrives", async () => {
    renderPanel();
    // Start and stop in the same tick: the import has not resolved yet.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Live view" }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(hls.instances).toHaveLength(0);
    expect(screen.queryByText("Live view unavailable")).toBeNull();
  });
});
