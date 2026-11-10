import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, userEvent, within } from "../../test-utils";
import { PushDeviceList } from "./PushDeviceList";
import * as api from "../../api";
import type { PushSubscription } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getPushSubscriptions: vi.fn(),
  renamePushSubscription: vi.fn(async () => ({})),
  deletePushSubscription: vi.fn(async () => {}),
}));

const mockedList = vi.mocked(api.getPushSubscriptions);
const mockedRename = vi.mocked(api.renamePushSubscription);
const mockedDelete = vi.mocked(api.deletePushSubscription);

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1";

function device(over: Partial<PushSubscription>): PushSubscription {
  return {
    id: "s1",
    userId: "u1",
    endpoint: "https://push/1",
    p256dh: "k",
    auth: "a",
    userAgent: IPHONE,
    createdAt: "2026-11-10T06:29:40Z",
    consecutiveFailures: 0,
    ...over,
  };
}

const removeCurrent = vi.fn(async () => {});

function renderList(currentEndpoint: string | null = "https://push/1") {
  return render(
    <PushDeviceList
      currentEndpoint={currentEndpoint}
      reloadKey="k"
      onRemoveCurrent={removeCurrent}
    />,
  );
}

describe("PushDeviceList (spec 199)", () => {
  beforeEach(() => {
    mockedList.mockReset();
    mockedRename.mockClear();
    mockedDelete.mockClear();
    removeCurrent.mockClear();
  });

  it("says when notifications are on nowhere", async () => {
    mockedList.mockResolvedValue([]);
    renderList(null);
    expect(
      await screen.findByText("Notifications are not on for any of your devices."),
    ).toBeTruthy();
  });

  it("names each device, marks this one, and shows the last delivery", async () => {
    const recent = new Date(Date.now() - 12 * 60_000).toISOString();
    mockedList.mockResolvedValue([
      device({ id: "s1", endpoint: "https://push/1", lastSuccessAt: recent, lastSentAt: recent }),
      device({
        id: "s2",
        endpoint: "https://push/2",
        label: "Old iPhone",
        lastSentAt: recent,
        lastError: "403 Forbidden",
        consecutiveFailures: 2,
      }),
      device({ id: "s3", endpoint: "https://push/3", userAgent: undefined }),
    ]);
    renderList();
    const rows = await screen.findAllByTestId("push-device");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("iPhone, iOS 27.2")).toBeTruthy();
    expect(within(rows[0]).getByText("This device")).toBeTruthy();
    expect(within(rows[0]).getByText(/accepted by the push service 12 min ago/)).toBeTruthy();
    expect(within(rows[1]).getByText("Old iPhone")).toBeTruthy();
    expect(within(rows[1]).queryByText("This device")).toBeNull();
    expect(within(rows[1]).getByText(/Last notification failed .*: 403 Forbidden/)).toBeTruthy();
    expect(within(rows[2]).getByText("Unknown device")).toBeTruthy();
    expect(within(rows[2]).getByText("No notification sent yet")).toBeTruthy();
  });

  it("renames a device inline", async () => {
    mockedList.mockResolvedValue([device({})]);
    renderList();
    await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Rename" });
    await userEvent.type(input, "Marc's iPhone{Enter}");
    expect(mockedRename).toHaveBeenCalledWith("s1", "Marc's iPhone");
  });

  it("asks before removing another device, then removes it by id", async () => {
    mockedList.mockResolvedValue([device({ id: "s2", endpoint: "https://push/2" })]);
    renderList();
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(mockedDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    expect(mockedDelete).toHaveBeenCalledWith("s2");
    expect(removeCurrent).not.toHaveBeenCalled();
  });

  it("removing this device also unsubscribes the browser", async () => {
    mockedList.mockResolvedValue([device({})]);
    renderList();
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    expect(removeCurrent).toHaveBeenCalledOnce();
    expect(mockedDelete).not.toHaveBeenCalled();
  });
});
