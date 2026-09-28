import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { UserRole } from "@lockal/domain";
import { useApp } from "../context/AppContext.js";

export function AppSidebar() {
  const { t } = useTranslation();
  const { auth, setAuth } = useApp();
  const location = useLocation();

  if (!auth) return null;

  const chatsActive = location.pathname === "/app" || location.pathname.startsWith("/chat/");

  return (
    <aside className="sidebar">
      <h2>{t("app.title")}</h2>
      <p>{auth.user.displayName}</p>
      <p style={{ color: "var(--muted)", fontSize: 14 }}>{auth.organization.name}</p>
      <nav>
        <NavLink to="/app" className={() => `nav-link${chatsActive ? " active" : ""}`}>
          💬 {t("nav.chats")}
        </NavLink>
        <NavLink to="/contacts" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          👥 {t("nav.contacts")}
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          ⚙️ {t("nav.settings")}
        </NavLink>
        {auth.user.role === UserRole.Admin && (
          <NavLink to="/admin" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            🛠 {t("admin.title")}
          </NavLink>
        )}
      </nav>
      <div className="sidebar-footer">
        <button className="secondary" onClick={() => setAuth(null)}>
          Выйти
        </button>
      </div>
    </aside>
  );
}
