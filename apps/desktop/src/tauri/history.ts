import { invoke, isTauri } from "@tauri-apps/api/core";
import { loadPersistedDatabase, clearPersistedDatabase, type HistoryStore } from "@lockal/database";

/** File-backed history for the desktop app. The first launch copies a
 * database that still lives in localStorage, then drops that copy so it
 * cannot grow into the browser quota. */
export function createDesktopHistoryStore(): HistoryStore | undefined {
  if (!isTauri()) return undefined;
  return {
    async load() {
      const raw = await invoke<ArrayBuffer>("load_history");
      const bytes = new Uint8Array(raw);
      if (bytes.byteLength > 0) return bytes;
      const legacy = loadPersistedDatabase();
      if (!legacy || legacy.byteLength === 0) return undefined;
      await invoke("save_history", legacy);
      clearPersistedDatabase();
      return legacy;
    },
    save(bytes: Uint8Array) {
      return invoke("save_history", bytes);
    },
    async clear() {
      clearPersistedDatabase();
      await invoke("delete_history");
    },
  };
}
