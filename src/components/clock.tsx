"use client";

import { useSyncExternalStore } from "react";
import { APP_TIME_ZONE } from "@/lib/time";

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: APP_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
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

// Shows India time whatever the device's own time zone is.
export function Clock() {
  const second = useSyncExternalStore(subscribe, currentSecond, serverSecond);
  if (second === null) return <div className="h-10" />;
  const now = new Date(second * 1000);
  return (
    <div className="leading-tight">
      <div className="text-sm text-muted">{dateFormat.format(now)}</div>
      <div className="font-mono text-lg font-semibold tabular-nums">{timeFormat.format(now)} IST</div>
    </div>
  );
}
