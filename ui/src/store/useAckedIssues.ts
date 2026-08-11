import { create } from "zustand";
import { loadAckedSignatures, saveAckedSignatures } from "../lib/acked-issues";

/**
 * Locally acknowledged banner issues (#424), keyed by issue signature.
 * Persisted to localStorage so an acknowledgement survives reloads. See
 * `lib/acked-issues.ts` for the signature and storage helpers.
 */
interface AckedIssuesState {
  acked: Set<string>;
  ack: (signature: string) => void;
  unack: (signature: string) => void;
}

export const useAckedIssues = create<AckedIssuesState>((set) => ({
  acked: new Set(loadAckedSignatures()),

  ack: (signature) =>
    set((s) => {
      if (s.acked.has(signature)) return s;
      const acked = new Set(s.acked);
      acked.add(signature);
      saveAckedSignatures([...acked]);
      return { acked };
    }),

  unack: (signature) =>
    set((s) => {
      if (!s.acked.has(signature)) return s;
      const acked = new Set(s.acked);
      acked.delete(signature);
      saveAckedSignatures([...acked]);
      return { acked };
    }),
}));
