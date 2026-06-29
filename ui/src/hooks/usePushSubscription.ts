import { useState, useEffect, useCallback } from "react";
import { getVapidPublicKey, subscribePush, unsubscribePush } from "../api";

// Spec 127 — Web Push subscription lifecycle for the installed PWA.

export type PushStatus =
  | "unsupported" // browser lacks serviceWorker / PushManager / Notification
  | "insecure" // not a secure context (HTTPS) — push cannot work
  | "default" // supported, not yet asked / not subscribed
  | "denied" // notification permission denied
  | "granted" // permission granted but no active subscription
  | "subscribed"; // active push subscription registered

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function usePushSubscription() {
  const supported =
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window;

  const [status, setStatus] = useState<PushStatus>(supported ? "default" : "unsupported");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supported) return setStatus("unsupported");
    if (!window.isSecureContext) return setStatus("insecure");
    if (Notification.permission === "denied") return setStatus("denied");
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) return setStatus("subscribed");
    return setStatus(Notification.permission === "granted" ? "granted" : "default");
  }, [supported]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const subscribe = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "default");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await getVapidPublicKey();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = sub.toJSON();
      await subscribePush({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
        userAgent: navigator.userAgent,
      });
      setStatus("subscribed");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await unsubscribePush(sub.endpoint).catch(() => undefined);
        await sub.unsubscribe();
      }
      setStatus(Notification.permission === "granted" ? "granted" : "default");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, supported, busy, error, subscribe, unsubscribe, refresh };
}
