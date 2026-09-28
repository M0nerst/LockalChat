/**
 * Abstraction for OS secure storage (Keychain, Credential Manager, etc.).
 * Phase 1: in-memory + optional file path for desktop dev; Tauri/Rust will implement platform stores.
 */
export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemorySecureStorage implements SecureStorage {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

const BROWSER_SECURE_PREFIX = "lockal.secure.";

/** Persists keys in localStorage (browser dev / PWA). Tauri uses OS secure store later. */
export class BrowserSecureStorage implements SecureStorage {
  async get(key: string): Promise<string | null> {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(BROWSER_SECURE_PREFIX + key);
  }

  async set(key: string, value: string): Promise<void> {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(BROWSER_SECURE_PREFIX + key, value);
  }

  async delete(key: string): Promise<void> {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(BROWSER_SECURE_PREFIX + key);
  }
}

export function createDefaultSecureStorage(): SecureStorage {
  if (typeof localStorage !== "undefined") {
    return new BrowserSecureStorage();
  }
  return new MemorySecureStorage();
}
