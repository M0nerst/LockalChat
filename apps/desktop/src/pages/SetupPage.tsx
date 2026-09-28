import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useNavigate } from "react-router-dom";
import { AuthError } from "@lockal/shared";
import { useApp } from "../context/AppContext.js";
import { AuthBrand } from "../components/AuthBrand.js";

export function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setupService, authService, setAuth, refreshOrganizationFlag, setLocalDeviceId, hasOrganization } =
    useApp();

  const [orgName, setOrgName] = useState("");
  const [username, setUsername] = useState("admin");
  const [displayName, setDisplayName] = useState("Администратор");
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceName] = useState("Мой ПК");
  const [fingerprints, setFingerprints] = useState<{ org: string; device: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hasOrganization && !fingerprints) {
      navigate("/login", { replace: true });
    }
  }, [hasOrganization, fingerprints, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await setupService.createOrganization({
        organizationName: orgName,
        adminUsername: username,
        adminDisplayName: displayName,
        adminPassword: password,
        deviceName,
        platform: navigator.platform,
        appVersion: "0.1.0",
      });
      setLocalDeviceId(result.deviceId);
      refreshOrganizationFlag();
      setFingerprints({ org: result.organizationFingerprint, device: result.deviceFingerprint });

      const auth = authService.login({
        organizationId: result.organizationId,
        username,
        password,
        deviceId: result.deviceId,
      });
      setAuth(auth);
      navigate("/app");
    } catch (err) {
      setError(
        err instanceof AuthError
          ? (err.userMessage ?? err.message)
          : (err as Error).message,
      );
    }
  }

  return (
    <div className="main auth-screen">
      <div className="card">
        <AuthBrand subtitle={t("setup.createOrg")} />
        <div className="auth-switch">
          <NavLink to="/setup" end className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Создать
          </NavLink>
          <NavLink to="/setup/join" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Подключиться
          </NavLink>
        </div>
        <form onSubmit={onSubmit}>
          <label>{t("setup.orgName")}</label>
          <input value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
          <label>{t("setup.adminUser")}</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          <label>{t("setup.adminDisplay")}</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          <label>{t("setup.password")}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <label>{t("setup.deviceName")}</label>
          <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} required />
          {error && <p className="error">{error}</p>}
          <button type="submit">{t("setup.submit")}</button>
        </form>
        {fingerprints && (
          <>
            <p>{t("setup.fingerprintOrg")}</p>
            <div className="fingerprint">{fingerprints.org}</div>
            <p>{t("setup.fingerprintDevice")}</p>
            <div className="fingerprint">{fingerprints.device}</div>
          </>
        )}
      </div>
    </div>
  );
}
