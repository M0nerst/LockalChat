import type { AuthContext } from "./auth-service.js";

export interface DaemonConfigFile {
  organization_id: string;
  device_id: string;
  user_id: string;
  public_key: string;
  lan_port: number;
  ui_ws_port: number;
  app_version: string;
  device_name: string;
}

export function buildDaemonConfig(
  auth: AuthContext,
  lanPort = 39200,
  uiWsPort = 39201,
): DaemonConfigFile {
  return {
    organization_id: auth.organization.id,
    device_id: auth.device.id,
    user_id: auth.user.id,
    public_key: auth.device.publicKey,
    lan_port: lanPort,
    ui_ws_port: uiWsPort,
    app_version: auth.device.appVersion,
    device_name: auth.device.name,
  };
}

export function daemonStartHint(_config?: DaemonConfigFile): string {
  return `cargo run -p lockal-daemon -- --config daemon-config.json`;
}
