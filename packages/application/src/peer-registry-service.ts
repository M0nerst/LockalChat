import { fingerprintFromPublicKey } from "@lockal/crypto";
import type { DatabaseContext } from "@lockal/database";
import { DeviceTrustStatus } from "@lockal/domain";
import type { PeerInfo } from "@lockal/networking";
import type { DeviceId, OrganizationId, UserId } from "@lockal/shared";
import { isoNow } from "@lockal/shared";

export class PeerRegistryService {
  constructor(private readonly db: DatabaseContext) {}

  upsertFromDiscovery(peers: PeerInfo[], organizationId: string): void {
    const now = isoNow();
    for (const p of peers) {
      if (!p.userId || !p.publicKey) continue;
      this.upsertDeviceFromPeer(p, organizationId, now);
      this.db.connection.exec(
        `INSERT INTO known_peers (device_id, user_id, organization_id, public_key, host, port, trust_status, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
           user_id = excluded.user_id,
           public_key = excluded.public_key,
           host = excluded.host,
           port = excluded.port,
           trust_status = excluded.trust_status,
           last_seen_at = excluded.last_seen_at`,
        [
          p.deviceId,
          p.userId,
          organizationId,
          p.publicKey,
          p.addresses[0]?.split(":")[0] ?? null,
          p.addresses[0]?.split(":")[1] ? Number(p.addresses[0].split(":")[1]) : null,
          p.trusted ? "trusted" : "pending",
          now,
        ],
      );
    }
  }

  private upsertDeviceFromPeer(p: PeerInfo, organizationId: string, now: string): void {
    const existing = this.db.devices.findById(p.deviceId as DeviceId);
    if (existing) {
      this.db.connection.exec(
        "UPDATE devices SET public_key = ?, last_seen_at = ? WHERE id = ?",
        [p.publicKey, now, p.deviceId],
      );
      return;
    }
    this.db.devices.create({
      id: p.deviceId as DeviceId,
      userId: p.userId as UserId,
      organizationId: organizationId as OrganizationId,
      name: "LAN device",
      platform: "lan",
      appVersion: "0.0",
      publicKey: p.publicKey,
      fingerprint: fingerprintFromPublicKey(p.publicKey),
      trustStatus: p.trusted ? DeviceTrustStatus.Trusted : DeviceTrustStatus.Pending,
      lastSeenAt: now,
      lastIp: p.addresses[0]?.split(":")[0] ?? null,
      createdAt: now,
    });
  }
}
