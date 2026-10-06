"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { HEARTBEAT_SECONDS, isMobileUserAgent } from "@/lib/attendance/presence";
import { heartbeatAction } from "@/server/actions/attendance";

// A laptop or desktop: a mouse or trackpad that can hover, and not a phone
// or tablet browser (iPads with a keyboard still report touch points).
function detectDesktop() {
  const ua = navigator.userAgent;
  const iPadAsMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return !isMobileUserAgent(ua) && !iPadAsMac && matchMedia("(pointer: fine)").matches && matchMedia("(hover: hover)").matches;
}

function subscribe(onChange: () => void) {
  const queries = [matchMedia("(pointer: fine)"), matchMedia("(hover: hover)")];
  queries.forEach((q) => q.addEventListener("change", onChange));
  return () => queries.forEach((q) => q.removeEventListener("change", onChange));
}

// true on a laptop or desktop, false on a phone or tablet, null before the
// page has loaded in the browser.
export function useIsDesktop(): boolean | null {
  return useSyncExternalStore(subscribe, detectDesktop, () => null);
}

// Tells the server once a minute that this laptop is still awake with the
// dashboard open, and checks again the moment the laptop wakes up. If the
// server stopped the timer meanwhile, the page reloads its data to show it.
export function PresenceHeartbeat({ state }: { state: string }) {
  const router = useRouter();
  const desktop = useIsDesktop();
  const known = useRef(state);
  useEffect(() => {
    known.current = state;
  }, [state]);

  useEffect(() => {
    if (!desktop) return;
    let busy = false;
    const beat = async () => {
      if (busy) return;
      busy = true;
      try {
        const today = await heartbeatAction();
        if (today && today.summary.state !== known.current) router.refresh();
      } catch {
        // Offline for a moment; the next beat tries again.
      } finally {
        busy = false;
      }
    };
    void beat();
    const timer = setInterval(beat, HEARTBEAT_SECONDS * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [desktop, router]);

  return null;
}
