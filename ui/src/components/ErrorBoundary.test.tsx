import { describe, expect, it, vi } from "vitest";
import { render, screen } from "../test-utils";
import { ErrorBoundary } from "./ErrorBoundary";

// #1187 — the layout wraps the routed page in an ErrorBoundary and passes the
// pathname as `resetKey`: a page that failed must not stay broken once the
// user navigates elsewhere (a `key` would remount the page on every change).

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error("page failed");
  return <p>page ok</p>;
}

describe("ErrorBoundary resetKey", () => {
  it("clears the error when resetKey changes", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Boom fail />
      </ErrorBoundary>,
    );
    expect(screen.getByText("page failed")).toBeTruthy();

    // Same key, child healthy now: the error stays until the key moves.
    rerender(
      <ErrorBoundary resetKey="/a">
        <Boom fail={false} />
      </ErrorBoundary>,
    );
    expect(screen.queryByText("page ok")).toBeNull();

    rerender(
      <ErrorBoundary resetKey="/b">
        <Boom fail={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("page ok")).toBeTruthy();
    spy.mockRestore();
  });
});
