import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext.js";
import { Avatar } from "../components/Avatar.js";
import { AppSidebar } from "../components/AppSidebar.js";
import { formatPresence } from "../utils/presence.js";

export function ContactsPage() {
  const navigate = useNavigate();
  const { auth, userAdminService, networkService } = useApp();
  const [users, setUsers] = useState(() =>
    auth ? userAdminService.listUsers(auth.user, auth.organization.id) : [],
  );
  const [peers, setPeers] = useState(() => networkService.transport.getPeers());

  useEffect(() => {
    const timer = setInterval(() => {
      void networkService.transport.discoverPeers();
      setPeers(networkService.transport.getPeers());
      if (auth) {
        setUsers(userAdminService.listUsers(auth.user, auth.organization.id));
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [networkService, auth, userAdminService]);

  if (!auth) return <Navigate to="/login" replace />;

  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="main">
        <h1>Контакты</h1>
        <div className="card" style={{ padding: 0, maxWidth: 640 }}>
          <h3 style={{ padding: "16px 20px 4px" }}>Сотрудники</h3>
          <ul className="chat-list" style={{ maxHeight: "none" }}>
            {users
              .filter((u) => u.id !== auth.user.id)
              .map((u) => (
                <li key={u.id} className="chat-list-item" onClick={() => navigate(`/chat/${u.id}`)}>
                  <Avatar id={u.id} name={u.displayName} online={u.presence === "online"} />
                  <div className="chat-list-item-body">
                    <div className="chat-list-item-top">
                      <span className="chat-list-name">{u.displayName}</span>
                    </div>
                    <div className="chat-list-preview">
                      @{u.username} · {formatPresence(u)}
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <h3>LAN-устройства рядом</h3>
          {peers.length === 0 && (
            <p style={{ color: "var(--muted)" }}>Устройства не обнаружены. Запустите lockal-daemon.</p>
          )}
          <ul>
            {peers.map((p) => (
              <li key={p.deviceId}>
                {users.find((u) => u.id === p.userId)?.displayName ?? p.userId} —{" "}
                <code style={{ fontSize: 12 }}>{p.deviceId}</code> —{" "}
                {p.addresses.join(", ") || "поиск адреса…"}{" "}
                {p.trusted ? "подключено" : "обнаружено"}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
