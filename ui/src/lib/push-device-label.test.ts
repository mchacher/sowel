import { describe, it, expect } from "vitest";
import { pushDeviceLabelFromUserAgent } from "./push-device-label";

describe("pushDeviceLabelFromUserAgent (spec 199)", () => {
  it.each([
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1",
      "iPhone, Safari 27.2",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1",
      "iPhone, Safari 27.0.1",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      "Android, Chrome 130",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
      "Windows, Firefox 131",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      "Mac, Edge 130",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
      "Mac, Safari 18.1",
    ],
  ])("names %s", (ua, label) => {
    expect(pushDeviceLabelFromUserAgent(ua)).toBe(label);
  });

  it("returns null when there is nothing to go on", () => {
    expect(pushDeviceLabelFromUserAgent(undefined)).toBeNull();
    expect(pushDeviceLabelFromUserAgent("curl/8.0")).toBeNull();
  });
});
