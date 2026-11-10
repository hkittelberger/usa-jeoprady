import { useCallback, useEffect, useState } from "react";

export function useToast() {
  const [msg, setMsg] = useState<{ text: string; key: number } | null>(null);
  const show = useCallback((text: string) => setMsg({ text, key: Date.now() }), []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div key={msg.key} className="fixed left-1/2 -translate-x-1/2 bottom-28 z-50 max-w-[90vw] rounded-xl bg-flag px-4 py-3 text-white font-semibold shadow-2xl anim-pop"
      onClick={() => setMsg(null)}>
      {msg.text}
    </div>
  ) : null;
  return { show, node };
}
