// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { copyToClipboard } from "./clipboard";

function mockClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

describe("copyToClipboard", () => {
  afterEach(() => {
    mockClipboard(undefined);
    vi.restoreAllMocks();
  });

  it("uses navigator.clipboard.writeText when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);

    const result = await copyToClipboard("hello");

    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when navigator.clipboard is unavailable (insecure context, e.g. plain HTTP)", async () => {
    mockClipboard(undefined);
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    const result = await copyToClipboard("backup-code-1");

    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("falls back to execCommand when navigator.clipboard.writeText throws", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    mockClipboard(writeText);
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    const result = await copyToClipboard("hello");

    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("returns false when both the clipboard API and execCommand fail", async () => {
    mockClipboard(undefined);
    document.execCommand = vi.fn().mockReturnValue(false);

    const result = await copyToClipboard("hello");

    expect(result).toBe(false);
  });

  it("removes the temporary textarea from the DOM after the fallback", async () => {
    mockClipboard(undefined);
    document.execCommand = vi.fn().mockReturnValue(true);

    await copyToClipboard("hello");

    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });
});
