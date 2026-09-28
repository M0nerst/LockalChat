const STORAGE_KEY = "lockal.sqlite";

// Building the base64 string one character at a time (`binary += ...`) is
// O(n) *string reallocations* and gets noticeably slow once the database is
// more than a couple hundred KB. Processing in chunks and using
// `String.fromCharCode(...chunk)` (bounded well under engines' call-argument
// limits) cuts persist() time dramatically for larger histories, while still
// avoiding the "spread the whole array as call args" stack-overflow risk.
const CHUNK_SIZE = 8192;

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    parts.push(String.fromCharCode(...chunk));
  }
  return btoa(parts.join(""));
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function loadPersistedDatabase(): Uint8Array | undefined {
  if (typeof localStorage === "undefined") return undefined;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return undefined;
  try {
    return base64ToBytes(raw);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return undefined;
  }
}

export function persistDatabase(bytes: Uint8Array): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, bytesToBase64(bytes));
}
