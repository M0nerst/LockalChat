import type { DatabaseContext } from "@lockal/database";
import { DeviceTrustStatus, PresenceStatus, UserRole, UserStatus } from "@lockal/domain";
import type { DirectorySnapshotPayload } from "@lockal/messaging";
import type { NetworkTransport } from "@lockal/networking";
import { createEnvelope, isoNow, messageId } from "@lockal/shared";
import { randomNonce, signEnvelope as cryptoSignEnvelope } from "@lockal/crypto";

export class DirectorySyncService {
  constructor(
    private readonly db: DatabaseContext,
    private readonly transport: NetworkTransport,
    private readonly orgPrivateKey: string,
    private readonly deviceId: string,
  ) {}

  async broadcastDirectory(): Promise<void> {
    const org = this.db.organizations.getFirst();
    if (!org) return;
    const users = this.db.users.listByOrganization(org.id);
    const devices = this.db.devices.listByOrganization(org.id);
    const payload: DirectorySnapshotPayload = {
      organizationId: org.id,
      users: users.map((u) => {
        const full = this.db.users.findByUsername(org.id, u.username)!;
        return {
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          role: u.role,
          status: u.status,
          passwordHash: full.passwordHash,
          updatedAt: u.updatedAt,
        };
      }),
      devices: devices.map((d) => ({
        id: d.id,
        userId: d.userId,
        name: d.name,
        platform: d.platform,
        appVersion: d.appVersion,
        publicKey: d.publicKey,
        fingerprint: d.fingerprint,
        trustStatus: d.trustStatus,
        lastSeenAt: d.lastSeenAt,
        createdAt: d.createdAt,
      })),
      issuedAt: isoNow(),
    };
    const envelope = createEnvelope({
      messageType: "sync.envelope",
      messageId: messageId(),
      senderDeviceId: this.deviceId,
      nonce: randomNonce(),
      payload: { kind: "directory.snapshot", data: payload },
    });
    envelope.signature = await cryptoSignEnvelope(this.orgPrivateKey, envelope);

    for (const peer of this.transport.getPeers()) {
      try {
        await this.transport.send(peer.deviceId, envelope);
      } catch {
        /* retry on next tick */
      }
    }
  }

  applyDirectorySnapshot(snapshot: DirectorySnapshotPayload): void {
    for (const u of snapshot.users) {
      const existing = this.db.users.findById(u.id as never);
      if (existing && existing.updatedAt >= u.updatedAt) continue;
      if (existing) {
        this.db.connection.exec(
          `UPDATE users SET username = ?, display_name = ?, role = ?, status = ?, password_hash = ?, updated_at = ?
           WHERE id = ?`,
          [u.username, u.displayName, u.role, u.status, u.passwordHash, u.updatedAt, u.id],
        );
      } else {
        this.db.users.create({
          id: u.id as never,
          organizationId: snapshot.organizationId as never,
          username: u.username,
          displayName: u.displayName,
          passwordHash: u.passwordHash,
          role: u.role as UserRole,
          status: u.status as UserStatus,
          departmentId: null,
          avatarUrl: null,
          presence: PresenceStatus.Offline,
          lastSeenAt: null,
          createdAt: u.updatedAt,
          updatedAt: u.updatedAt,
        });
      }
    }
    for (const d of snapshot.devices ?? []) {
      const existing = this.db.devices.findById(d.id as never);
      if (existing) {
        this.db.connection.exec(
          `UPDATE devices SET user_id = ?, name = ?, platform = ?, app_version = ?, public_key = ?,
           fingerprint = ?, trust_status = ?, last_seen_at = ? WHERE id = ?`,
          [
            d.userId,
            d.name,
            d.platform,
            d.appVersion,
            d.publicKey,
            d.fingerprint,
            d.trustStatus,
            d.lastSeenAt,
            d.id,
          ],
        );
      } else {
        this.db.devices.create({
          id: d.id as never,
          userId: d.userId as never,
          organizationId: snapshot.organizationId as never,
          name: d.name,
          platform: d.platform,
          appVersion: d.appVersion,
          publicKey: d.publicKey,
          fingerprint: d.fingerprint,
          trustStatus: d.trustStatus as DeviceTrustStatus,
          lastSeenAt: d.lastSeenAt,
          lastIp: null,
          createdAt: d.createdAt,
        });
      }
    }
  }
}
