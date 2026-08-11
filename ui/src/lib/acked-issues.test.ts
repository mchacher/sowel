import { describe, it, expect, beforeEach } from "vitest";
import { issueSignature, loadAckedSignatures, saveAckedSignatures } from "./acked-issues";

function makeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => {
      m.delete(k);
    },
    setItem: (k, v) => {
      m.set(k, v);
    },
  };
}

beforeEach(() => {
  globalThis.localStorage = makeStorage();
});

describe("issueSignature", () => {
  it("is stable for the same source / level / message", () => {
    const a = issueSignature({ source: "panasonic_cc", level: "warning", message: "PAC offline" });
    const b = issueSignature({ source: "panasonic_cc", level: "warning", message: "PAC offline" });
    expect(a).toBe(b);
  });

  it("changes when the message changes (a new problem re-surfaces)", () => {
    const a = issueSignature({ source: "panasonic_cc", level: "warning", message: "PAC offline" });
    const b = issueSignature({ source: "panasonic_cc", level: "warning", message: "PAC error 42" });
    expect(a).not.toBe(b);
  });

  it("changes when the level or source changes", () => {
    const base = { source: "s", level: "warning", message: "m" };
    expect(issueSignature(base)).not.toBe(issueSignature({ ...base, level: "error" }));
    expect(issueSignature(base)).not.toBe(issueSignature({ ...base, source: "other" }));
  });

  it("does not collide across field boundaries", () => {
    // "a" + "b|c" must not equal "a|b" + "c" — the separator prevents it.
    const x = issueSignature({ source: "a", level: "b", message: "c" });
    const y = issueSignature({ source: "a", level: "bc", message: "" });
    expect(x).not.toBe(y);
  });
});

describe("load / save acknowledged signatures", () => {
  it("round-trips through localStorage", () => {
    saveAckedSignatures(["sig-1", "sig-2"]);
    expect(loadAckedSignatures()).toEqual(["sig-1", "sig-2"]);
  });

  it("returns an empty array when nothing is stored", () => {
    expect(loadAckedSignatures()).toEqual([]);
  });

  it("returns an empty array on corrupt JSON", () => {
    localStorage.setItem("sowel_acked_issues", "{not json");
    expect(loadAckedSignatures()).toEqual([]);
  });

  it("ignores a stored value that is not an array of strings", () => {
    localStorage.setItem("sowel_acked_issues", JSON.stringify({ nope: 1 }));
    expect(loadAckedSignatures()).toEqual([]);
    localStorage.setItem("sowel_acked_issues", JSON.stringify(["ok", 5, null, "ok2"]));
    expect(loadAckedSignatures()).toEqual(["ok", "ok2"]);
  });

  it("does not throw when storage is unavailable", () => {
    globalThis.localStorage = {
      ...makeStorage(),
      setItem: () => {
        throw new Error("storage disabled");
      },
    } as Storage;
    expect(() => saveAckedSignatures(["x"])).not.toThrow();
  });
});
