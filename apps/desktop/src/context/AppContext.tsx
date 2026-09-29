import {
  AppState,
  AuthService,
  NetworkService,
  SetupService,
  JoinService,
  InviteService,
  DeviceAdminService,
  AuditService,
  UserAdminService,
  type AuthContext,
} from "@lockal/application";
import { isTauri } from "@tauri-apps/api/core";
import { ChatService } from "@lockal/messaging";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createDesktopHistoryStore } from "../tauri/history.js";

interface AppContextValue {
  ready: boolean;
  hasOrganization: boolean;
  auth: AuthContext | null;
  setupService: SetupService;
  authService: AuthService;
  userAdminService: UserAdminService;
  chatService: ChatService;
  networkService: NetworkService;
  joinService: JoinService;
  inviteService: InviteService;
  deviceAdminService: DeviceAdminService;
  auditService: AuditService;
  setAuth: (auth: AuthContext | null) => void;
  patchAuthUser: (user: AuthContext["user"]) => void;
  refreshOrganizationFlag: () => void;
  localDeviceId: string | null;
  setLocalDeviceId: (id: string) => void;
  persist: () => void;
  resetLocalData: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const SESSION_KEY = "lockal.session";
const DEVICE_KEY = "lockal.deviceId";

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [ready, setReady] = useState(false);
  const [hasOrganization, setHasOrganization] = useState(false);
  const [auth, setAuthState] = useState<AuthContext | null>(null);
  const [localDeviceId, setLocalDeviceIdState] = useState<string | null>(
    localStorage.getItem(DEVICE_KEY),
  );
  const networkRef = useRef<NetworkService | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const history = createDesktopHistoryStore();
        const app = await AppState.create(undefined, history);
        setState(app);
        networkRef.current = new NetworkService(app.db, app.secureStorage);
        networkRef.current.setPersistHook(() => app.persist());
        setHasOrganization(!!app.db.organizations.getFirst());

        // persist() is debounced, so the last change can still be waiting
        // when the window closes. The desktop build writes that snapshot to
        // disk before the window is destroyed.
        window.addEventListener("beforeunload", () => app.flush());
        if (isTauri()) {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const win = getCurrentWindow();
          let closing = false;
          await win.onCloseRequested(async (event) => {
            if (closing) return;
            event.preventDefault();
            closing = true;
            try {
              await app.flushNow();
            } finally {
              await win.destroy();
            }
          });
        }

        const token = localStorage.getItem(SESSION_KEY);
        if (token) {
          const authService = new AuthService(app.db);
          const ctx = authService.validateSession(token);
          if (ctx) {
            app.setAuth(ctx);
            setAuthState(ctx);
            await networkRef.current.start(ctx).catch((err) => {
            console.error("Network start failed:", err);
          });
          } else {
            localStorage.removeItem(SESSION_KEY);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setInitError(message);
        console.error("LockalChat init failed:", err);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const value = useMemo(() => {
    if (!state || !networkRef.current) {
      return null;
    }
    const networkService = networkRef.current;
    const setupService = new SetupService(state.db, state.secureStorage);
    const joinService = new JoinService(state.db, state.secureStorage);
    const inviteService = new InviteService(state.db);
    const deviceAdminService = new DeviceAdminService(state.db);
    const auditService = new AuditService(state.db);
    const authService = new AuthService(state.db);
    const userAdminService = new UserAdminService(state.db);
    const chatService = new ChatService(state.db);

    return {
      ready,
      hasOrganization,
      auth,
      setupService,
      authService,
      userAdminService,
      chatService,
      networkService,
      joinService,
      inviteService,
      deviceAdminService,
      auditService,
      setAuth: (next: AuthContext | null) => {
        if (auth && !next) {
          networkService.stop();
        }
        state.setAuth(next);
        setAuthState(next);
        if (next) {
          localStorage.setItem(SESSION_KEY, next.sessionToken);
          localStorage.setItem(DEVICE_KEY, next.device.id);
          setLocalDeviceIdState(next.device.id);
          void networkService.start(next);
        } else {
          localStorage.removeItem(SESSION_KEY);
        }
        state.persist();
      },
      patchAuthUser: (user) => {
        setAuthState((prev) => {
          if (!prev) return prev;
          const next = { ...prev, user };
          state.setAuth(next);
          return next;
        });
        state.persist();
      },
      refreshOrganizationFlag: () => {
        setHasOrganization(!!state.db.organizations.getFirst());
      },
      localDeviceId,
      setLocalDeviceId: (id: string) => {
        localStorage.setItem(DEVICE_KEY, id);
        setLocalDeviceIdState(id);
      },
      persist: () => state.persist(),
      resetLocalData: () => {
        networkService.stop();
        void (async () => {
          await state.clearHistory();
          const doomed: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith("lockal.") || key.startsWith("lockal.secure."))) {
              doomed.push(key);
            }
          }
          for (const key of doomed) localStorage.removeItem(key);
          if (typeof indexedDB !== "undefined") {
            indexedDB.deleteDatabase("lockalchat-blobs");
          }
          window.location.reload();
        })();
      },
    } satisfies AppContextValue;
  }, [state, ready, hasOrganization, auth, localDeviceId]);

  if (initError) {
    return (
      <div className="main">
        <div className="card">
          <h1>Не удалось запустить приложение</h1>
          <p className="error">{initError}</p>
          <p style={{ fontSize: 14, color: "var(--muted)" }}>
            Частая причина — не скопирован файл SQLite (WASM). Остановите сервер и снова выполните{" "}
            <code>npm run dev</code> из корня проекта.
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void (async () => {
                localStorage.removeItem("lockal.sqlite");
                localStorage.removeItem(SESSION_KEY);
                if (isTauri()) {
                  const { invoke } = await import("@tauri-apps/api/core");
                  await invoke("delete_history").catch(() => undefined);
                }
                window.location.reload();
              })();
            }}
          >
            Сбросить локальные данные и перезагрузить
          </button>
        </div>
      </div>
    );
  }

  if (!value) return <div className="main">Инициализация базы данных…</div>;

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside provider");
  return ctx;
}
