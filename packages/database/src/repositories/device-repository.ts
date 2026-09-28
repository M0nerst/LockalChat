import type { Device } from "@lockal/domain";
import { DeviceTrustStatus } from "@lockal/domain";
import type { DeviceId, OrganizationId, UserId } from "@lockal/shared";
import type { SqliteConnection } from "../connection.js";

type DeviceRow = {
  id: string;
  user_id: string;
  organization_id: string;
  name: string;
  platform: string;
  app_version: string;
  public_key: string;
  fingerprint: string;
  trust_status: string;
  last_seen_at: string | null;
  last_ip: string | null;
  created_at: string;
};

function mapDevice(row: DeviceRow): Device {
  return {
    id: row.id as DeviceId,
    userId: row.user_id as UserId,
    organizationId: row.organization_id as OrganizationId,
    name: row.name,
    platform: row.platform,
    appVersion: row.app_version,
    publicKey: row.public_key,
    fingerprint: row.fingerprint,
    trustStatus: row.trust_status as DeviceTrustStatus,
    lastSeenAt: row.last_seen_at,
    lastIp: row.last_ip,
    createdAt: row.created_at,
  };
}

export class DeviceRepository {
  constructor(private readonly db: SqliteConnection) {}

  create(device: Device): void {
    this.db.exec(
      `INSERT INTO devices (
        id, user_id, organization_id, name, platform, app_version,
        public_key, fingerprint, trust_status, last_seen_at, last_ip, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        device.id,
        device.userId,
        device.organizationId,
        device.name,
        device.platform,
        device.appVersion,
        device.publicKey,
        device.fingerprint,
        device.trustStatus,
        device.lastSeenAt,
        device.lastIp,
        device.createdAt,
      ],
    );
  }

  findById(id: DeviceId): Device | null {
    const row = this.db.get<DeviceRow>("SELECT * FROM devices WHERE id = ?", [id]);
    return row ? mapDevice(row) : null;
  }

  listByOrganization(organizationId: OrganizationId): Device[] {
    return this.db
      .all<DeviceRow>("SELECT * FROM devices WHERE organization_id = ?", [organizationId])
      .map(mapDevice);
  }

  listByUser(userId: UserId): Device[] {
    return this.db.all<DeviceRow>("SELECT * FROM devices WHERE user_id = ?", [userId]).map(mapDevice);
  }

  updateTrust(id: DeviceId, status: DeviceTrustStatus): void {
    this.db.exec("UPDATE devices SET trust_status = ? WHERE id = ?", [status, id]);
  }
}
