import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import type { OrganizationInviteV1 } from "@lockal/application";
import { useApp } from "../context/AppContext.js";
import { AuthBrand } from "../components/AuthBrand.js";

export function JoinSetupPage() {
  const navigate = useNavigate();
  const { joinService, setAuth, setLocalDeviceId, refreshOrganizationFlag, persist, hasOrganization } =
    useApp();
  const [inviteText, setInviteText] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceName] = useState("Моё устройство");
  const [error, setError] = useState<string | null>(null);
  const [inviteFileName, setInviteFileName] = useState<string | null>(null);

  useEffect(() => {
    if (hasOrganization) {
      navigate("/login", { replace: true });
    }
  }, [hasOrganization, navigate]);

  async function onInviteFile(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      setInviteText(text);
      setInviteFileName(file.name);
      const parsed = JSON.parse(text) as OrganizationInviteV1;
      if (parsed.user?.username) {
        setUsername(parsed.user.username);
      }
    } catch {
      setError("Не удалось прочитать файл приглашения. Нужен JSON из Admin → Export.");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const invite = JSON.parse(inviteText) as OrganizationInviteV1;
      const result = await joinService.join({
        invite,
        username,
        password,
        deviceName,
        platform: navigator.platform,
        appVersion: "0.1.0",
      });
      setLocalDeviceId(result.deviceId);
      refreshOrganizationFlag();
      setAuth(result.auth);
      persist();
      navigate("/app");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="main auth-screen">
      <div className="card" style={{ maxWidth: 640 }}>
        <AuthBrand subtitle="Подключение к организации" />
        <div className="auth-switch">
          <NavLink to="/setup" end className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Создать
          </NavLink>
          <NavLink to="/setup/join" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Подключиться
          </NavLink>
        </div>
        <p className="auth-subtitle" style={{ textAlign: "left" }}>
          Вставьте JSON из Admin → Export или выберите файл <code>lockal-invite-….json</code>. Перед
          входом сверьте отпечаток организации в JSON.
        </p>
        <form onSubmit={onSubmit}>
          <label htmlFor="invite-json">JSON приглашения (текст)</label>
          <textarea
            id="invite-json"
            value={inviteText}
            onChange={(e) => {
              setInviteText(e.target.value);
              setInviteFileName(null);
            }}
            required
            rows={10}
            placeholder='{"version":1,"organization":{...},"user":{...}}'
          />
          <label htmlFor="invite-file">Или файл приглашения (.json)</label>
          <input
            id="invite-file"
            type="file"
            accept=".json,application/json"
            onChange={(e) => void onInviteFile(e.target.files?.[0] ?? null)}
          />
          {inviteFileName && (
            <p style={{ fontSize: 13, color: "var(--muted)", marginTop: -8, marginBottom: 12 }}>
              Загружен: {inviteFileName}
            </p>
          )}
          <label htmlFor="join-username">Логин</label>
          <input
            id="join-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
          />
          <label htmlFor="join-password">Пароль</label>
          <input
            id="join-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <label htmlFor="join-device">Имя устройства</label>
          <input
            id="join-device"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            required
          />
          {error && <p className="error">{error}</p>}
          <button type="submit">Подключиться</button>
        </form>
      </div>
    </div>
  );
}
