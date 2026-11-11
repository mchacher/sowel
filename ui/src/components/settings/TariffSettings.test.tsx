import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, userEvent } from "../../test-utils";
import i18n from "../../i18n";
import { TariffSettings } from "./TariffSettings";
import * as api from "../../api";
import type { TariffConfig } from "../../types";

vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  getTariffConfig: vi.fn(),
  saveTariffConfig: vi.fn(),
  getPriceFileStatus: vi.fn(),
}));

// The contract and price blocks have their own tests; only the schedule is read here.
vi.mock("./TariffContractBlock", () => ({ TariffContractBlock: () => null }));
vi.mock("./TariffPriceHistory", () => ({ TariffPriceHistory: () => null }));
vi.mock("./TariffPriceProposals", () => ({ TariffPriceProposals: () => null }));

const mockedGet = vi.mocked(api.getTariffConfig);
const mockedSave = vi.mocked(api.saveTariffConfig);

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WINTER = [
  { start: "06:00", end: "22:00", tariff: "hp" as const },
  { start: "22:00", end: "06:00", tariff: "hc" as const },
];
const SUMMER = [
  { start: "02:00", end: "07:00", tariff: "hc" as const },
  { start: "07:00", end: "12:00", tariff: "hp" as const },
  { start: "12:00", end: "15:00", tariff: "hc" as const },
  { start: "15:00", end: "02:00", tariff: "hp" as const },
];

const single: TariffConfig = {
  schedules: [{ days: ALL_DAYS, slots: WINTER }],
  prices: { hp: 0, hc: 0 },
};
const seasonal: TariffConfig = {
  ...single,
  summer: { from: "04-01", to: "10-31", schedules: [{ days: ALL_DAYS, slots: SUMMER }] },
};

const box = () =>
  screen.findByRole("checkbox", {
    name: "My off-peak hours change between summer and winter",
  }) as Promise<HTMLInputElement>;

describe("TariffSettings schedule (spec 204)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mockedGet.mockReset();
    mockedSave.mockReset();
    mockedSave.mockResolvedValue(undefined);
    vi.mocked(api.getPriceFileStatus).mockResolvedValue(null as never);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 15, 12)); // 15 July, in summer
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows one schedule unticked and saves it without summer", async () => {
    mockedGet.mockResolvedValue(single);
    render(<TariffSettings />);
    expect((await box()).checked).toBe(false);
    expect(screen.queryByTestId("season-summer")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    await vi.waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
    expect(mockedSave.mock.calls[0][0]).toEqual({ schedules: [{ days: ALL_DAYS, slots: WINTER }] });
  });

  it("copies the current slots into summer the first time the box is ticked", async () => {
    mockedGet.mockResolvedValue(single);
    render(<TariffSettings />);
    await userEvent.click(await box());

    const summer = screen.getByTestId("season-summer");
    expect(summer.textContent).toContain("From April 1 to October 31");
    expect(screen.getByTestId("season-winter").textContent).toContain(
      "From November 1 to March 31",
    );
    const times = Array.from(summer.querySelectorAll<HTMLInputElement>('input[type="time"]'));
    expect(times.map((i) => i.value)).toEqual(["06:00", "22:00", "22:00", "06:00"]);

    await userEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    await vi.waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
    expect(mockedSave.mock.calls[0][0]).toEqual({
      schedules: [{ days: ALL_DAYS, slots: WINTER }],
      summer: { from: "04-01", to: "10-31", schedules: [{ days: ALL_DAYS, slots: WINTER }] },
    });
  });

  it("shows a stored summer ticked, marks the season in force, and saves both", async () => {
    mockedGet.mockResolvedValue(seasonal);
    render(<TariffSettings />);
    expect((await box()).checked).toBe(true);
    expect(screen.getByTestId("season-summer").textContent).toContain("Current");
    expect(screen.getByTestId("season-winter").textContent).not.toContain("Current");

    await userEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    await vi.waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
    expect(mockedSave.mock.calls[0][0]).toEqual({
      schedules: seasonal.schedules,
      summer: seasonal.summer,
    });
  });

  it("stacks the seasons and keeps both headers the same height (#1230)", async () => {
    mockedGet.mockResolvedValue(seasonal);
    render(<TariffSettings />);
    await box();
    // One column at every width: a half-width season wrapped each slot.
    const seasons = screen.getByTestId("seasons");
    expect(seasons.className).toContain("flex-col");
    expect(seasons.className).not.toMatch(/grid-cols-2/);
    // The header row has a fixed height and the pill no vertical padding, so
    // « Current » does not push the season in force lower than the other one.
    const heads = screen.getAllByTestId("season-head");
    expect(heads).toHaveLength(2);
    for (const head of heads) expect(head.className).toContain("h-5");
    const pill = screen.getByText("Current");
    expect(pill.className).not.toMatch(/\bpy-/);
    expect(pill.className).toContain("leading-4.5");
  });

  it("marks winter in force in January", async () => {
    vi.setSystemTime(new Date(2027, 0, 15, 12));
    mockedGet.mockResolvedValue(seasonal);
    render(<TariffSettings />);
    await box();
    expect(screen.getByTestId("season-winter").textContent).toContain("Current");
    expect(screen.getByTestId("season-summer").textContent).not.toContain("Current");
  });

  it("saves a single schedule once a stored summer is unticked", async () => {
    mockedGet.mockResolvedValue(seasonal);
    render(<TariffSettings />);
    await userEvent.click(await box());
    expect(screen.queryByTestId("season-summer")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    await vi.waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
    expect(mockedSave.mock.calls[0][0]).toEqual({ schedules: seasonal.schedules });
  });

  it("writes the dates in French from the stored season", async () => {
    await i18n.changeLanguage("fr");
    mockedGet.mockResolvedValue(seasonal);
    render(<TariffSettings />);
    await screen.findByRole("checkbox", {
      name: "Mes heures creuses changent entre l'été et l'hiver",
    });
    expect(screen.getByTestId("season-winter").textContent).toContain("Du 1er novembre au 31 mars");
    expect(screen.getByTestId("season-summer").textContent).toContain("En cours");
  });
});
