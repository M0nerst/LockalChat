import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AuthError } from "@lockal/shared";
import { useApp } from "../context/AppContext.js";
import { AuthBrand } from "../components/AuthBrand.js";

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { authService, setAuth, localDeviceId } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const org = authService.getLocalOrganization();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (!org || !localDeviceId) {
        setError(t("login.error"));
        return;
      }
      const auth = authService.login({
        organizationId: org.id,
        username,
        password,
        deviceId: localDeviceId as never,
      });
      setAuth(auth);
      navigate("/app");
    } catch (err) {
      setError(err instanceof AuthError ? (err.userMessage ?? t("login.error")) : t("login.error"));
    }
  }

  return (
    <div className="main auth-screen">
      <div className="card">
        <AuthBrand subtitle={org ? org.name : undefined} />
        <form onSubmit={onSubmit}>
          <label>{t("login.username")}</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
          <label>{t("login.password")}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          {error && <p className="error">{error}</p>}
          <button type="submit">{t("login.submit")}</button>
        </form>
      </div>
    </div>
  );
}
