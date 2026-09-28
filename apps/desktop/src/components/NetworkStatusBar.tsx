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

  const dotClass = daemonOk === null ? "" : daemonOk ? "ok" : "down";
  const label =
    daemonOk === null ? "Сеть: проверка…" : daemonOk ? `LAN · ${connected} из ${peers}` : "Нет связи с LAN";
  const title = import.meta.env.DEV
    ? "В режиме разработки служба LAN стартует при входе"
    : "Локальная сеть между устройствами организации";

  return (
    <div className="lan-status" title={title}>
      <span className={`lan-dot ${dotClass}`} />
      <span>{label}</span>
    </div>
  );
}
