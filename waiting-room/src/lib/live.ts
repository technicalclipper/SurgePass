import { useEffect, useRef } from "react";

// Public live feed from the gateway: drop state, entry counts, draw progress, bids.

type Handler = (msg: any) => void;
const handlers = new Set<Handler>();
let ws: WebSocket | null = null;

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/_sp/live`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    for (const h of handlers) h(msg);
  };
  ws.onclose = () => setTimeout(connect, 1000);
}

export function useLive(dropId: string | undefined, fn: Handler) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!ws) connect();
    const h: Handler = (m) => {
      if (!dropId || m.drop === dropId) ref.current(m);
    };
    handlers.add(h);
    return () => void handlers.delete(h);
  }, [dropId]);
}
