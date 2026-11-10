import { useEffect, useRef, useState } from "react";
import { fmtScore } from "../lib/util";

/** Counts toward the new value and floats a +/- delta above it. */
export function AnimatedNumber({ value, className = "", showDelta = true }: { value: number; className?: string; showDelta?: boolean }) {
  const [shown, setShown] = useState(value);
  const [delta, setDelta] = useState<{ n: number; key: number } | null>(null);
  const prev = useRef(value);

  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    if (showDelta) setDelta({ n: value - from, key: Date.now() });
    const start = performance.now(), dur = 900;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - (1 - p) ** 3;
      setShown(Math.round(from + (value - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, showDelta]);

  return (
    <span className={`relative inline-block tabular-nums ${className}`}>
      {fmtScore(shown)}
      {delta && (
        <span key={delta.key} className={`anim-float absolute left-1/2 -translate-x-1/2 -top-2 font-display text-[0.8em] ${delta.n > 0 ? "text-good" : "text-flag"}`}
          style={{ textShadow: "0 0 8px #000" }}>
          {delta.n > 0 ? "+" : "−"}{Math.abs(delta.n)}
        </span>
      )}
    </span>
  );
}
