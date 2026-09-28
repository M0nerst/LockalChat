import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "@lockal/ui";
import { AppProvider, useApp } from "./context/AppContext.js";
import { SetupPage } from "./pages/SetupPage.js";
import { JoinSetupPage } from "./pages/JoinSetupPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { MessengerPage } from "./pages/MessengerPage.js";
import { AdminPage } from "./pages/AdminPage.js";
import { ContactsPage } from "./pages/ContactsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";

function BootGate({ children }: { children: React.ReactNode }) {
  const { ready } = useApp();
  if (!ready) return <div className="main">Загрузка…</div>;
  return <>{children}</>;
}

function RootRedirect() {
  const { hasOrganization, auth } = useApp();
  if (!hasOrganization) return <Navigate to="/setup" replace />;
  if (!auth) return <Navigate to="/login" replace />;
  return <Navigate to="/app" replace />;
}

export function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <BrowserRouter>
          <BootGate>
            <div className="app-viewport">
              <div className="route-viewport">
                <Routes>
                  <Route path="/" element={<RootRedirect />} />
                  <Route path="/setup" element={<SetupPage />} />
                  <Route path="/setup/join" element={<JoinSetupPage />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/app" element={<MessengerPage />} />
                  <Route path="/contacts" element={<ContactsPage />} />
                  <Route path="/chat/:userId" element={<MessengerPage />} />
              <Route path="/group/:groupId" element={<MessengerPage />} />
                  <Route path="/admin" element={<AdminPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Routes>
              </div>
            </div>
          </BootGate>
        </BrowserRouter>
      </AppProvider>
    </ThemeProvider>
  );
}
