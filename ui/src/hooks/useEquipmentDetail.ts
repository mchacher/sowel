import { useCallback, useEffect, useRef, useState } from "react";
import { getEquipment } from "../api";
import { apiErrorStatus } from "../lib/api-error";
import { useEquipments } from "../store/useEquipments";
import type { EquipmentWithDetails } from "../types";

export interface EquipmentDetail {
  /** What to show: the live store entry, else the page's own fetch. */
  equipment: EquipmentWithDetails | null;
  /** `equipment` comes from the store, which the WebSocket keeps live. */
  fromStore: boolean;
  /** The server says this equipment does not exist (404). */
  notFound: boolean;
  /**
   * The last fetch failed (other than 404). Without `equipment` the page shows the error
   * and a retry; with a fetched copy only (not in the store) it keeps it and shows a
   * notice; with the store's live entry the failure does not matter and is not shown.
   */
  error: unknown;
  retry: () => void;
}

/** What the page's own fetch learnt, for the id it was made for. */
interface Loaded {
  id: string;
  equipment: EquipmentWithDetails | null;
  notFound: boolean;
  error: unknown;
}

/**
 * The equipment page's data (spec 196, FR-2).
 *
 * The page used to re-fetch `GET /equipments/:id` each time its store entry changed, that
 * is on every reading the equipment pushed (a heat pump's clamp, its energy cumuls), and
 * any failure of those refreshes replaced a loaded page with « Équipement introuvable »
 * that stayed until the user left. A 429 from that very storm was the usual cause.
 *
 * `GET /equipments/:id` and the list the store holds are built by the same server code
 * (`getByIdWithDetails` / `getAllWithDetails`, same shape, nothing more), and the store
 * entry is kept live by the WebSocket (readings patched in place, the list refetched on
 * `equipment.updated`). So the page fetches once, to answer fast and to learn about a 404,
 * then reads the store. It fetches again only on a retry, or when the entry leaves the
 * store (deleted elsewhere: the 404 then says so). A failed refresh never hides data
 * already on screen.
 *
 * The fetch result is tagged with its id, so moving from one equipment to another never
 * shows the previous one's result, even for the render before the new fetch starts.
 */
export function useEquipmentDetail(id: string | undefined): EquipmentDetail {
  const fromStore = useEquipments((s) =>
    id ? s.equipments.find((eq) => eq.id === id) : undefined,
  );
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getEquipment(id)
      .then((data) => {
        if (cancelled) return;
        setLoaded({ id, equipment: data, notFound: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const is404 = apiErrorStatus(err) === 404;
        setLoaded((prev) => {
          const same = prev?.id === id ? prev : null;
          return {
            id,
            equipment: same?.equipment ?? null,
            notFound: is404 || (same?.notFound ?? false),
            error: is404 ? null : err,
          };
        });
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  // The entry left the store after being there, for this same id: ask the server whether
  // it still exists. Seen per id, so arriving on B from A (both in the store) still
  // notices B leaving.
  const inStore = fromStore !== undefined;
  const seen = useRef({ id, inStore });
  useEffect(() => {
    const prev = seen.current;
    if (prev.id === id && prev.inStore && !inStore) setAttempt((n) => n + 1);
    seen.current = { id, inStore };
  }, [id, inStore]);

  const retry = useCallback(() => {
    setLoaded((prev) => (prev ? { ...prev, error: null } : prev));
    setAttempt((n) => n + 1);
  }, []);

  const current = id !== undefined && loaded?.id === id ? loaded : null;
  return {
    equipment: fromStore ?? current?.equipment ?? null,
    fromStore: inStore,
    notFound: current?.notFound ?? false,
    error: current?.error ?? null,
    retry,
  };
}
