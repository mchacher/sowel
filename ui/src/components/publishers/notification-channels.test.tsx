import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../../test-utils";
import { NOTIFICATION_CHANNELS, channelSpec, channelConfigComplete } from "./notification-channels";
import { ChannelConfigFields } from "./ChannelConfigFields";

// Generic notification-channel descriptors (issue #457 step 2): adding a channel
// is a descriptor entry, and the form renders/validates from it.

describe("notification channel descriptors", () => {
  it("round-trips telegram config through fromConfig/toConfig", () => {
    const tg = channelSpec("telegram");
    const values = tg.fromConfig({ botToken: "abc", chatId: "-100" });
    expect(values).toEqual({ botToken: "abc", chatId: "-100" });
    expect(tg.toConfig(values)).toEqual({ botToken: "abc", chatId: "-100" });
    // trims on save
    expect(tg.toConfig({ botToken: " a ", chatId: " b " })).toEqual({ botToken: "a", chatId: "b" });
  });

  it("web-push has no config and an empty object config", () => {
    const wp = channelSpec("web-push");
    expect(wp.fields).toHaveLength(0);
    expect(wp.toConfig({})).toEqual({});
    expect(wp.fromConfig(undefined)).toEqual({});
  });

  it("channelConfigComplete requires telegram's required fields, web-push always complete", () => {
    const tg = channelSpec("telegram");
    expect(channelConfigComplete(tg, { botToken: "", chatId: "" })).toBe(false);
    expect(channelConfigComplete(tg, { botToken: "x", chatId: "" })).toBe(false);
    expect(channelConfigComplete(tg, { botToken: "x", chatId: "y" })).toBe(true);
    expect(channelConfigComplete(channelSpec("web-push"), {})).toBe(true);
  });

  it("registry lists web-push and telegram", () => {
    expect(NOTIFICATION_CHANNELS.map((c) => c.type)).toEqual(["web-push", "telegram"]);
  });
});

describe("ChannelConfigFields", () => {
  it("renders the telegram fields and fires onChange", () => {
    const onChange = vi.fn();
    render(
      <ChannelConfigFields
        spec={channelSpec("telegram")}
        values={{ botToken: "", chatId: "" }}
        onChange={onChange}
      />,
    );
    const inputs = screen.getAllByRole("textbox");
    // chatId is a text field (botToken is type=password, not a textbox role)
    expect(inputs.length).toBeGreaterThanOrEqual(1);
    fireEvent.change(inputs[0], { target: { value: "-100" } });
    expect(onChange).toHaveBeenCalledWith("chatId", "-100");
  });

  it("renders only a hint for web-push (no config fields)", () => {
    render(<ChannelConfigFields spec={channelSpec("web-push")} values={{}} onChange={vi.fn()} />);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
