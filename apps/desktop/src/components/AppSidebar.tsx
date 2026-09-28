import { type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { UserRole } from "@lockal/domain";
import { useApp } from "../context/AppContext.js";
import { Avatar } from "./Avatar.js";
import { NetworkStatusBar } from "./NetworkStatusBar.js";

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      {children}
    </svg>
  );
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function AppSidebar() {
  const { t } = useTranslation();
  const { auth, setAuth } = useApp();
  const location = useLocation();

  if (!auth) return null;

  const chatsActive =
    location.pathname === "/app" ||
    location.pathname.startsWith("/chat/") ||
    location.pathname.startsWith("/group/");

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src="/logo.png" alt="" width={28} height={28} />
        <span>{t("app.title")}</span>
      </div>
      <NavLink to="/settings" className="sidebar-profile">
        <Avatar id={auth.user.id} name={auth.user.displayName} avatarUrl={auth.user.avatarUrl} size={40} />
        <div className="sidebar-profile-text">
          <div className="sidebar-profile-name">{auth.user.displayName}</div>
          <div className="sidebar-profile-org">{auth.organization.name}</div>
        </div>
      </NavLink>
      <nav>
        <NavLink to="/app" className={() => `nav-link${chatsActive ? " active" : ""}`}>
          <NavIcon>
            <path
              {...stroke}
              d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.4-4 8-9 8a9.8 9.8 0 0 1-4-.8L3 20l1.2-3.6A7.7 7.7 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8z"
            />
          </NavIcon>
          {t("nav.chats")}
        </NavLink>
        <NavLink to="/contacts" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          <NavIcon>
            <path {...stroke} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle {...stroke} cx="9" cy="7" r="4" />
            <path {...stroke} d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </NavIcon>
          {t("nav.contacts")}
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          <NavIcon>
            <path {...stroke} d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
          </NavIcon>
          {t("nav.settings")}
        </NavLink>
        {auth.user.role === UserRole.Admin && (
          <NavLink to="/admin" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            <NavIcon>
              <path {...stroke} d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </NavIcon>
            {t("admin.title")}
          </NavLink>
        )}
      </nav>
      <div className="sidebar-footer">
        <NetworkStatusBar />
        <button className="secondary" onClick={() => setAuth(null)}>
          Выйти
        </button>
      </div>
    </aside>
  );
}
