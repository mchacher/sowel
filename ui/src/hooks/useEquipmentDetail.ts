import { useCallback, useEffect, useRef, useState } from "react";
import { getEquipment } from "../api";
import { apiErrorStatus } from "../lib/api-error";
import { useEquipments } from "../store/useEquipments";
import type { EquipmentWithDetails } from "../types";

export interface EquipmentDetail {
  /** What to show: the live store entry, else the page's own fetch. */
  equipment: EquipmentWithDetails | null;
  /** The server says this equipment does not exist (404). */
  notFound: boolean;
  /**
   * The last fetch failed (other than 404). With `equipment` in hand the page keeps it
   * and shows a notice; without, it shows the error and a retry.
   */
  error: unknown;
  retry: () => void;
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
 */
export function useEquipmentDetail(id: string | undefined): EquipmentDetail {
  const fromStore = useEquipments((s) =>
    id ? s.equipments.find((eq) => eq.id === id) : undefined,
  );
  const [fetched, setFetched] = useState<EquipmentWithDetails | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const wasInStore = useRef(false);

  // A new id starts from nothing.
  useEffect(() => {
    setFetched(null);
    setNotFound(false);
    setError(null);
    wasInStore.current = false;
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getEquipment(id)
      .then((data) => {
        if (cancelled) return;
        setFetched(data);
        setNotFound(false);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (apiErrorStatus(err) === 404) setNotFound(true);
        else setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  // The entry left the store after being there: ask the server whether it still exists.
  const inStore = fromStore !== undefined;
  useEffect(() => {
    if (wasInStore.current && !inStore) setAttempt((n) => n + 1);
    wasInStore.current = inStore;
  }, [inStore]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  return { equipment: fromStore ?? fetched, notFound, error, retry };
}
