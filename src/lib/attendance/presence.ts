// Work time only counts on a laptop or desktop with the dashboard open
// (Aarif, 6 Oct 2026). The open dashboard tells the server it is still there
// once a minute; when those signals stop (lid closed, asleep, switched off,
// tab closed) the session is stopped at the last signal.

export const HEARTBEAT_SECONDS = 60;
// A session with no signal for this long is stopped. Missed signals in a
// background tab can be up to a minute late, so this leaves some slack; the
// stop is recorded at the last signal, so the slack is never counted as work.
export const IDLE_STOP_MINUTES = 3;

export const IDLE_STOP_NOTE = "Stopped automatically: no signal from the laptop (lid closed, asleep, switched off or dashboard closed).";

// Phones and tablets, judged from the browser's own description. Easy to
// fake on purpose, but it stops the everyday "tap Log in on my phone".
export function isMobileUserAgent(userAgent: string | null | undefined, mobileHint?: string | null): boolean {
  if (mobileHint === "?1") return true;
  if (!userAgent) return false;
  return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile|webOS/i.test(userAgent);
}

export const DESKTOP_ONLY_MESSAGE = "Start, pause and stop work from your laptop or desktop. Attendance buttons do not work on phones or tablets.";
