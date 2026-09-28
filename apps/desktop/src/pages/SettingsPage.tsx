import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { i18n, useTheme } from "@lockal/ui";
import { useApp } from "../context/AppContext.js";
import { AppSidebar } from "../components/AppSidebar.js";
import { Avatar } from "../components/Avatar.js";
import { AVATAR_PALETTE } from "../utils/avatar.js";

export function SettingsPage() {
  const { auth, networkService, resetLocalData, userAdminService, patchAuthUser, persist } = useApp();
  const { mode, setMode } = useTheme();
  const [daemonOk, setDaemonOk] = useState<boolean | null>(null);
  const [lang, setLang] = useState(i18n.language);
  const [advanced, setAdvanced] = useState(false);
  const [lanPort, setLanPort] = useState(localStorage.getItem("lockal.lanPort") ?? "39200");
  const [uiWsPort, setUiWsPort] = useState(localStorage.getItem("lockal.uiWsPort") ?? "39201");
  const [daemonWsUrl, setDaemonWsUrl] = useState(
    localStorage.getItem("lockal.daemonWsUrl") ?? networkService.transport.getWsUrl(),
  );
  const [displayName, setDisplayName] = useState(auth?.user.displayName ?? "");
  const [avatarUrl, setAvatarUrl] = useState(auth?.user.avatarUrl ?? null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileOk, setProfileOk] = useState(false);

  useEffect(() => {
    void networkService.transport
      .discoverPeers()
      .then(() => setDaemonOk(true))
      .catch(() => setDaemonOk(false));
  }, [networkService]);

  if (!auth) return <Navigate to="/login" replace />;

  function changeLang(next: "ru" | "en") {
    void i18n.changeLanguage(next);
    setLang(next);
  }

  function downloadDaemonConfig() {
    const raw = localStorage.getItem("lockal.daemonConfig");
    if (!raw) return;
    const blob = new Blob([raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "daemon-config.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function unlinkDevice() {
    const ok = window.confirm(
      "Это удалит локальную организацию, чаты и файлы только на этом компьютере. Другие устройства не затронуты. Продолжить?",
    );
    if (!ok) return;
    resetLocalData();
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!auth) return;
    setProfileError(null);
    setProfileOk(false);
    try {
      const user = userAdminService.updateOwnProfile(auth.user, {
        displayName,
        avatarUrl,
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
      });
      patchAuthUser(user);
      persist();
      await networkService.syncDirectory();
      setCurrentPassword("");
      setNewPassword("");
      setProfileOk(true);
    } catch (err) {
      setProfileError((err as Error).message);
    }
  }

  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="main">
        <div className="card">
          <h3>Профиль</h3>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <Avatar id={auth.user.id} name={displayName || auth.user.displayName} avatarUrl={avatarUrl} size={64} />
          </div>
          <form onSubmit={(e) => void saveProfile(e)}>
            <label htmlFor="profile-name">Отображаемое имя</label>
            <input id="profile-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            <label>Цвет аватарки</label>
            <div className="color-swatches">
              <button
                type="button"
                className={`color-swatch${!avatarUrl ? " selected" : ""}`}
                style={{ ["--swatch" as string]: "#8a8478" }}
                title="Как раньше"
                onClick={() => setAvatarUrl(null)}
              />
              {AVATAR_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-swatch${avatarUrl === `color:${color}` ? " selected" : ""}`}
                  style={{ ["--swatch" as string]: color }}
                  onClick={() => setAvatarUrl(`color:${color}`)}
                />
              ))}
            </div>
            <label htmlFor="profile-login">Логин</label>
            <input id="profile-login" value={auth.user.username} disabled />
            <label htmlFor="profile-current">Текущий пароль</label>
            <input
              id="profile-current"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Только если меняете пароль"
            />
            <label htmlFor="profile-new">Новый пароль</label>
            <input
              id="profile-new"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            {profileError && <p className="error">{profileError}</p>}
            {profileOk && <p style={{ color: "var(--muted)", fontSize: 14 }}>Сохранено</p>}
            <button type="submit">Сохранить профиль</button>
          </form>
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Сеть</h3>
          <p>
            LAN:{" "}
            {daemonOk === null ? "проверка…" : daemonOk ? "подключено" : "нет связи с локальным сервисом"}
          </p>
          <p style={{ fontSize: 14, color: "var(--muted)" }}>
            {import.meta.env.DEV
              ? "В режиме разработки lockal-daemon стартует сам при входе (см. строку статуса сверху). Для второго браузера просто войдите там под другим пользователем — будет второй daemon на своих портах."
              : "В desktop-приложении (Tauri) daemon запускается вместе с окном."}
          </p>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            WebSocket: <code>{networkService.transport.getWsUrl()}</code>
          </p>
          <button type="button" className="secondary" onClick={() => setAdvanced((v) => !v)}>
            {advanced ? "Скрыть" : "Расширенные"} настройки портов
          </button>
          {advanced && (
            <div style={{ marginTop: 12 }}>
              <label>Порт LAN</label>
              <input value={lanPort} onChange={(e) => setLanPort(e.target.value)} />
              <label>Порт WebSocket службы (UI)</label>
              <input value={uiWsPort} onChange={(e) => setUiWsPort(e.target.value)} />
              <label>Адрес WebSocket службы</label>
              <input value={daemonWsUrl} onChange={(e) => setDaemonWsUrl(e.target.value)} />
              <button
                type="button"
                className="secondary"
                style={{ marginTop: 8 }}
                onClick={() => {
                  localStorage.setItem("lockal.lanPort", lanPort);
                  localStorage.setItem("lockal.uiWsPort", uiWsPort);
                  localStorage.setItem("lockal.daemonWsUrl", daemonWsUrl);
                  alert("Сохранено. Выйдите и войдите снова.");
                }}
              >
                Сохранить порты
              </button>
              <button type="button" style={{ marginLeft: 8 }} onClick={downloadDaemonConfig}>
                Скачать daemon-config.json
              </button>
            </div>
          )}
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Внешний вид</h3>
          <select value={mode} onChange={(e) => setMode(e.target.value as "light" | "dark" | "system")}>
            <option value="system">Системная</option>
            <option value="light">Светлая</option>
            <option value="dark">Тёмная</option>
          </select>
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Язык</h3>
          <button type="button" className="secondary" disabled={lang === "ru"} onClick={() => changeLang("ru")}>
            Русский
          </button>{" "}
          <button type="button" className="secondary" disabled={lang === "en"} onClick={() => changeLang("en")}>
            English
          </button>
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Устройство</h3>
          <div className="fingerprint">{auth.device.fingerprint}</div>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 12 }}>
            Если нужно заново подключиться по приглашению (например, сменить организацию), отвяжите
            устройство — локальные данные на этом компьютере будут стёрты.
          </p>
          <button type="button" className="secondary" style={{ marginTop: 8 }} onClick={unlinkDevice}>
            Отвязать это устройство
          </button>
        </div>
      </main>
    </div>
  );
}
