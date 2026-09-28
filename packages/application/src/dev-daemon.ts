/** Dev-only: ask Vite plugin to spawn lockal-daemon for this device config. */
export async function ensureDevDaemonRunning(configJson: string): Promise<{
  wsUrl: string;
  lanPort: number;
  uiWsPort: number;
} | null> {
  if (typeof fetch === "undefined") return null;
  try {
    const res = await fetch("/__lockal/daemon/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: configJson,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      wsUrl: string;
      lanPort: number;
      uiWsPort: number;
    };
    return data;
  } catch {
    return null;
  }
}
