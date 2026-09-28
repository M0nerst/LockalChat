import { useEffect, useState } from "react";
import { useApp } from "../context/AppContext.js";

export function NetworkStatusBar() {
  const { auth, networkService } = useApp();
  const [daemonOk, setDaemonOk] = useState<boolean | null>(null);
  const [peers, setPeers] = useState(0);
  const [connected, setConnected] = useState(0);

  useEffect(() => {
    if (!auth) return;
    const tick = () => {
      void networkService.transport
        .discoverPeers()
        .then(() => {
          setDaemonOk(true);
          const list = networkService.transport.getPeers();
          setPeers(list.length);
          setConnected(list.filter((p) => p.trusted).length);
        })
        .catch(() => setDaemonOk(false));
    };
    tick();
    const timer = setInterval(tick, 4000);
    return () => clearInterval(timer);
  }, [auth, networkService]);

  if (!auth) return null;

  const daemonLabel =
    daemonOk === null ? "сеть: проверка…" : daemonOk ? "сервис LAN: работает" : "сервис LAN: нет связи";

  return (
    <div
      style={{
        fontSize: 13,
        color: "var(--muted)",
        padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        textAlign: "center",
      }}
    >
      {daemonLabel} · устройств в LAN: {peers} · P2P-сессий: {connected}
      {import.meta.env.DEV && (
        <span style={{ marginLeft: 8 }}>
          (daemon запускается автоматически при входе — отдельный терминал не нужен)
        </span>
      )}
    </div>
  );
}
