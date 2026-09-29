import { createDefaultSecureStorage, type SecureStorage } from "@lockal/crypto";
import {
  SqliteConnection,
  DatabaseContext,
  browserHistoryStore,
  type HistoryStore,
} from "@lockal/database";
import type { AuthContext } from "./auth-service.js";

// `persist()` is called very frequently — once per chat message, once per
// file chunk, once per inbound envelope. Without debouncing, a transfer
// would rewrite the whole database hundreds of times on the main thread.
// Bursts collapse into one trailing write.
const PERSIST_DEBOUNCE_MS = 400;

export class AppState {
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private latest: Uint8Array | null = null;
  private flight: Promise<void> | null = null;

  private constructor(
    readonly db: DatabaseContext,
    public auth: AuthContext | null,
    readonly secureStorage: SecureStorage,
    private readonly history: HistoryStore,
  ) {}

  static async create(
    secureStorage: SecureStorage = createDefaultSecureStorage(),
    history?: HistoryStore,
  ): Promise<AppState> {
    const store = history ?? browserHistoryStore();
    const persisted = await store.load();
    const connection = await SqliteConnection.open(!persisted, persisted);
    const db = new DatabaseContext(connection);
    return new AppState(db, null, secureStorage, store);
  }

  /** Schedules a write, coalescing bursts of calls into a single flush. */
  persist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flush();
    }, PERSIST_DEBOUNCE_MS);
  }

  /** Writes immediately, bypassing any pending debounced write.
   * Call this before the app closes so the last changes are not lost. */
  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.latest = this.db.export();
    if (this.history.sync) {
      this.history.save(this.latest);
      this.latest = null;
      return;
    }
    this.kick();
  }

  /** Waits until a file-backed write has finished. */
  async flushNow(): Promise<void> {
    this.flush();
    while (this.flight) {
      await this.flight;
    }
  }

  async clearHistory(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.latest = null;
    while (this.flight) {
      await this.flight;
    }
    await this.history.clear();
  }

  private kick(): void {
    if (this.flight || !this.latest) return;
    const bytes = this.latest;
    this.latest = null;
    this.flight = Promise.resolve(this.history.save(bytes))
      .catch((err) => {
        if (typeof console !== "undefined") {
          console.error("Не удалось сохранить историю", err);
        }
      })
      .then(() => {
        this.flight = null;
        if (this.latest) this.kick();
      });
  }

  setAuth(auth: AuthContext | null): void {
    this.auth = auth;
  }
}
