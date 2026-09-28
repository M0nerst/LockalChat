export async function persistDaemonConfigForTauri(configJson: string): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<string>("save_daemon_config", { configJson });
  } catch {
    /* browser dev mode */
  }
}
