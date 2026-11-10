import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMsg, ServerMsg, View } from "../../shared/types";

export type ConnStatus = "checking" | "connecting" | "open" | "reconnecting" | "notfound";

/**
 * Connects to a room's Durable Object, re-sends `hello` on every (re)connect,
 * keeps a server-clock offset (ping/pong) and reconnects with exponential backoff.
 */
export function useRoom(code: string | null, hello: () => ClientMsg | null, onMessage?: (m: ServerMsg) => void) {
  const [view, setView] = useState<View | null>(null);
  const [status, setStatus] = useState<ConnStatus>("checking");
  const wsRef = useRef<WebSocket | null>(null);
  const offsetRef = useRef(0);
  const bestRtt = useRef(Infinity);
  const helloRef = useRef(hello);
  helloRef.current = hello;
  const onMsgRef = useRef(onMessage);
  onMsgRef.current = onMessage;

  useEffect(() => {
    if (!code) return;
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    setView(null);
    setStatus("checking");

    const ping = () => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping", t: Date.now() } satisfies ClientMsg));
    };

    const connect = () => {
      if (stopped) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/ws/${code}`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setStatus("open");
        const h = helloRef.current();
        if (h) ws.send(JSON.stringify(h));
        bestRtt.current = Infinity;
        ping();
        setTimeout(ping, 300);
        setTimeout(ping, 900);
      };
      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === "state") setView(msg.view);
        else if (msg.type === "pong") {
          const now = Date.now();
          const rtt = now - msg.t;
          // Prefer the lowest-latency sample; let it drift slowly otherwise.
          if (rtt <= bestRtt.current * 1.5 || rtt < 150) {
            bestRtt.current = Math.min(bestRtt.current, rtt);
            offsetRef.current = msg.server - (msg.t + rtt / 2);
          }
        }
        onMsgRef.current?.(msg);
      };
      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        if (stopped) return;
        setStatus("reconnecting");
        const delay = Math.min(15000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
        attempt++;
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };

    fetch(`/api/rooms/${code}`)
      .then((r) => r.json())
      .then((r: { exists: boolean }) => {
        if (stopped) return;
        if (!r.exists) { setStatus("notfound"); return; }
        setStatus("connecting");
        connect();
      })
      .catch(() => { if (!stopped) { setStatus("connecting"); connect(); } });

    pingTimer = setInterval(ping, 15000);

    // Phones lock / tabs sleep: reconnect immediately when we come back.
    const wake = () => {
      if (document.visibilityState !== "visible" || stopped) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        clearTimeout(timer);
        attempt = 0;
        connect();
      } else ping();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(pingTimer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
  }, [code]);

  const send = useCallback((m: ClientMsg) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(m)); return true; }
    return false;
  }, []);

  /** Re-send hello (e.g. after login/join changes credentials). */
  const rehello = useCallback(() => {
    const h = helloRef.current();
    if (h) send(h);
  }, [send]);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  return { view, status, send, rehello, serverNow };
}
