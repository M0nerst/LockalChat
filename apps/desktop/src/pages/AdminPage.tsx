import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { AuditEventType, DeviceTrustStatus, UserRole } from "@lockal/domain";
import { PermissionError } from "@lockal/shared";
import { useApp } from "../context/AppContext.js";
import { AppSidebar } from "../components/AppSidebar.js";

type AdminTab = "users" | "devices" | "audit";

const TRUST_LABELS: Record<string, string> = {
  [DeviceTrustStatus.Pending]: "Ожидает",
  [DeviceTrustStatus.Trusted]: "Доверено",
  [DeviceTrustStatus.Revoked]: "Отозвано",
};

const AUDIT_LABELS: Record<string, string> = {
  [AuditEventType.Login]: "Вход",
  [AuditEventType.Logout]: "Выход",
  [AuditEventType.UserCreated]: "Пользователь создан",
  [AuditEventType.UserDeleted]: "Пользователь удалён",
  [AuditEventType.UserBlocked]: "Пользователь блокирован",
  [AuditEventType.UserUnblocked]: "Пользователь разблокирован",
  [AuditEventType.PermissionChanged]: "Права изменены",
  [AuditEventType.DeviceAdded]: "Устройство добавлено",
  [AuditEventType.DeviceRevoked]: "Устройство отозвано",
  [AuditEventType.OrganizationCreated]: "Организация создана",
};

export function AdminPage() {
  const { t } = useTranslation();
  const { auth, userAdminService, deviceAdminService, auditService, inviteService, persist } = useApp();
  const [tab, setTab] = useState<AdminTab>("users");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Re-query periodically so changes from other admins/devices show up, but
  // otherwise leave these DB reads memoized on `tick` — without this, every
  // keystroke while typing in the "create user" form (or any other local
  // state change) would re-run three DB queries per render for no reason.
  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), 4000);
    return () => clearInterval(timer);
  }, []);

  // `tick` is intentionally in each dependency array purely as a cache-bust
  // signal (bumped by the timer above and by refresh()) — it's not read
  // inside the callbacks themselves, hence the exhaustive-deps warning below.
  const users = useMemo(
    () => (auth ? userAdminService.listUsers(auth.user, auth.organization.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userAdminService, auth, tick],
  );
  const devices = useMemo(
    () => (auth ? deviceAdminService.listDevices(auth.user, auth.organization.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deviceAdminService, auth, tick],
  );
  const audit = useMemo(
    () => (auth ? auditService.list(auth.user, auth.organization.id, 50) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auditService, auth, tick],
  );

  if (!auth) return <Navigate to="/login" replace />;
  if (auth.user.role !== UserRole.Admin) return <Navigate to="/app" replace />;

  const tabLabels: Record<AdminTab, string> = {
    users: "Пользователи",
    devices: "Устройства",
    audit: "Журнал аудита",
  };

  function userName(id: string): string {
    return users.find((u) => u.id === id)?.displayName ?? id;
  }

  function refresh() {
    persist();
    setTick((v) => v + 1);
  }

  function exportInvite(userId: string) {
    const invite = inviteService.exportUserInvite(auth!.user, userId as never);
    const blob = new Blob([JSON.stringify(invite, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lockal-invite-${invite.user?.username ?? "user"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      userAdminService.createUser(auth!.user, {
        username,
        displayName,
        password,
        role: UserRole.User,
      });
      setUsername("");
      setDisplayName("");
      setPassword("");
      refresh();
    } catch (err) {
      setError(
        err instanceof PermissionError
          ? (err.userMessage ?? (err as Error).message)
          : (err as Error).message,
      );
    }
  }

  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="main">
      <h1>{t("admin.title")}</h1>
      <nav style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["users", "devices", "audit"] as AdminTab[]).map((key) => (
          <button
            key={key}
            type="button"
            className={tab === key ? undefined : "secondary"}
            onClick={() => setTab(key)}
          >
            {tabLabels[key]}
          </button>
        ))}
      </nav>

      {tab === "users" && (
        <>
          <div className="card" style={{ maxWidth: 860 }}>
            <h2>{t("admin.users")}</h2>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">Логин</th>
                  <th align="left">Имя</th>
                  <th align="left">Роль</th>
                  <th align="left">Статус</th>
                  <th align="left">Действия</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td>{u.displayName}</td>
                    <td>{u.role === UserRole.Admin ? "Администратор" : "Пользователь"}</td>
                    <td>{u.status === "active" ? "Активен" : "Блокирован"}</td>
                    <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {u.role !== UserRole.Admin && u.id !== auth.user.id && u.status === "active" && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            userAdminService.blockUser(auth.user, u.id);
                            refresh();
                          }}
                        >
                          Блокировать
                        </button>
                      )}
                      {u.status === "blocked" && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            userAdminService.unblockUser(auth.user, u.id);
                            refresh();
                          }}
                        >
                          Разблокировать
                        </button>
                      )}
                      {u.role !== UserRole.Admin && (
                        <button type="button" className="secondary" onClick={() => exportInvite(u.id)}>
                          Экспорт invite
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <h3>Новый пользователь</h3>
            <form onSubmit={onCreate}>
              <label>Логин</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} required />
              <label>Отображаемое имя</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
              <label>Пароль</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              {error && <p className="error">{error}</p>}
              <button type="submit">Создать</button>
            </form>
          </div>
        </>
      )}

      {tab === "devices" && (
        <div className="card" style={{ maxWidth: 860 }}>
          <h2>Устройства</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Имя</th>
                <th align="left">Пользователь</th>
                <th align="left">Платформа</th>
                <th align="left">Доверие</th>
                <th align="left">Отпечаток</th>
                <th align="left">Действия</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{userName(d.userId)}</td>
                  <td>{d.platform}</td>
                  <td>{TRUST_LABELS[d.trustStatus] ?? d.trustStatus}</td>
                  <td>
                    <code style={{ fontSize: 11 }}>{d.fingerprint}</code>
                  </td>
                  <td>
                    {d.trustStatus !== "revoked" && d.id !== auth.device.id && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          deviceAdminService.revokeDevice(auth.user, d.id);
                          refresh();
                        }}
                      >
                        Отозвать
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "audit" && (
        <div className="card" style={{ maxWidth: 860 }}>
          <h2>Журнал аудита</h2>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {audit.map((e) => (
              <li key={e.id} style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
                <strong>{AUDIT_LABELS[e.eventType] ?? e.eventType}</strong>
                <span style={{ color: "var(--muted)", marginLeft: 8 }}>{e.createdAt}</span>
                <pre style={{ fontSize: 12, margin: "4px 0 0" }}>{e.detailsJson}</pre>
              </li>
            ))}
          </ul>
        </div>
      )}
      </main>
    </div>
  );
}
