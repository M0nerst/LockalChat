import { createDefaultSecureStorage, type SecureStorage } from "@lockal/crypto";
import {
  SqliteConnection,
  DatabaseContext,
  loadPersistedDatabase,
  persistDatabase,
} from "@lockal/database";
import type { AuthContext } from "./auth-service.js";

// Exporting the whole SQLite database and base64-encoding it into
// localStorage is not free, and `persist()` is called very frequently —
// once per chat message, once per *file chunk* sent or received, once per
// inbound sync envelope, etc. Without debouncing, a single file transfer
// with a few hundred chunks means a few hundred full-database
// serialize+encode+write cycles back to back on the main thread. Coalescing
// bursts into a single trailing write (at most once per PERSIST_DEBOUNCE_MS)
// keeps the UI responsive while still guaranteeing data is written shortly
// after the last change.
const PERSIST_DEBOUNCE_MS = 400;

export class AppState {
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(
    readonly db: DatabaseContext,
    public auth: AuthContext | null,
    readonly secureStorage: SecureStorage,
  ) {}

  static async create(secureStorage: SecureStorage = createDefaultSecureStorage()): Promise<AppState> {
    const persisted = loadPersistedDatabase();
    const connection = await SqliteConnection.open(!persisted, persisted);
    const db = new DatabaseContext(connection);
    return new AppState(db, null, secureStorage);
  }

  /** Schedules a write, coalescing bursts of calls into a single flush. */
  persist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flush();
    }, PERSIST_DEBOUNCE_MS);
  }

  /** Writes immediately, bypassing/cancelling any pending debounced write.
   * Call this before the app closes so a pending debounce window can never
   * cause the last few changes to be lost. */
  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    persistDatabase(this.db.export());
  }

  setAuth(auth: AuthContext | null): void {
    this.auth = auth;
  }
}
