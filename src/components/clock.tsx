"use client";

import { useSyncExternalStore } from "react";
import { APP_TIME_ZONE } from "@/lib/time";

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function subscribe(onTick: () => void) {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
}
const currentSecond = () => Math.floor(Date.now() / 1000);
// Rendered empty on the server so the first paint never shows a stale time.
const serverSecond = () => null;

// Current time in whole seconds, re-rendering every second; null on the server.
export function useNowSecond() {
  return useSyncExternalStore(subscribe, currentSecond, serverSecond);
}

// Shows India time whatever the device's own time zone is.
export function Clock() {
  const second = useNowSecond();
  if (second === null) return <div className="h-10" />;
  const now = new Date(second * 1000);
  return (
    <div className="leading-tight">
      <div className="text-xs font-medium text-muted">{dateFormat.format(now)}</div>
      <div className="text-lg font-bold tabular-nums">
        {timeFormat.format(now)} <span className="text-xs font-semibold text-muted">IST</span>
      </div>
    </div>
  );
}
