import { describe, expect, it } from "vitest";
import type { HistoryStore } from "@lockal/database";
import { AppState } from "./app-state.js";

describe("AppState history store", () => {
  it("writes the database through a synchronous store and can clear it", async () => {
    const saved: Uint8Array[] = [];
    const store: HistoryStore = {
      sync: true,
      async load() {
        return undefined;
      },
      save(bytes) {
        saved.push(bytes);
      },
      clear() {
        saved.length = 0;
      },
    };
    const app = await AppState.create(undefined, store);
    app.flush();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.byteLength).toBeGreaterThan(0);
    await app.clearHistory();
    expect(saved).toHaveLength(0);
  });
});
