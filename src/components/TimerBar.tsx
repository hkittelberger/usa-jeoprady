import { useEffect, useState } from "react";

/** Shrinking countdown bar driven by the server's timerEndsAt + clock offset. */
export function TimerBar({ endsAt, duration, serverNow, big = false, showSeconds = true }: {
  endsAt: number | null; duration: number | null; serverNow: () => number; big?: boolean; showSeconds?: boolean;
}) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    if (endsAt == null) return;
    let raf = 0;
    const loop = () => { setNow(serverNow()); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [endsAt, serverNow]);

  if (endsAt == null || !duration) return null;
  const remaining = Math.max(0, endsAt - now);
  const frac = Math.min(1, remaining / duration);
  const danger = remaining <= 5000;
  return (
    <div className="flex items-center gap-3 w-full">
      <div className={`flex-1 rounded-full bg-white/15 overflow-hidden ${big ? "h-8" : "h-5"}`}>
        <div
          className={`h-full rounded-full ${danger ? "bg-flag" : "bg-white"}`}
          style={{ width: `${frac * 100}%`, transition: "background-color .3s" }}
        />
      </div>
      {showSeconds && (
        <div className={`font-display tabular-nums ${big ? "text-6xl w-20" : "text-3xl w-12"} text-right ${danger ? "text-flag" : ""}`}>
          {Math.ceil(remaining / 1000)}
        </div>
      )}
    </div>
  );
}
