import { describe, it, expect, beforeEach } from "vitest";
import { useAckedIssues } from "./useAckedIssues";

// Zustand store is a module singleton; reset between tests.
beforeEach(() => {
  useAckedIssues.setState({ acked: new Set() });
});

describe("useAckedIssues", () => {
  it("acks a signature", () => {
    useAckedIssues.getState().ack("sig-a");
    expect(useAckedIssues.getState().acked.has("sig-a")).toBe(true);
  });

  it("ack is idempotent", () => {
    const { ack } = useAckedIssues.getState();
    ack("sig-a");
    ack("sig-a");
    expect(useAckedIssues.getState().acked.size).toBe(1);
  });

  it("unacks a signature", () => {
    const { ack, unack } = useAckedIssues.getState();
    ack("sig-a");
    unack("sig-a");
    expect(useAckedIssues.getState().acked.has("sig-a")).toBe(false);
  });

  it("produces a new Set reference on change (so subscribers re-render)", () => {
    const before = useAckedIssues.getState().acked;
    useAckedIssues.getState().ack("sig-a");
    expect(useAckedIssues.getState().acked).not.toBe(before);
  });

  it("keeps other acknowledgements when one is restored", () => {
    const { ack, unack } = useAckedIssues.getState();
    ack("sig-a");
    ack("sig-b");
    unack("sig-a");
    expect(useAckedIssues.getState().acked.has("sig-a")).toBe(false);
    expect(useAckedIssues.getState().acked.has("sig-b")).toBe(true);
  });
});
