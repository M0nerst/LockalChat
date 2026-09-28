import { randomNonce, signEnvelope as cryptoSignEnvelope } from "@lockal/crypto";
import type { DatabaseContext } from "@lockal/database";
import { PresenceStatus } from "@lockal/domain";
import type { NetworkTransport } from "@lockal/networking";
import { createEnvelope, isoNow, messageId, type DeviceId, type UserId } from "@lockal/shared";

export interface PresenceUpdatePayload {
  userId: UserId;
  status: PresenceStatus;
  at: string;
}

export class PresenceService {
  /** Last status we announced for the local user, re-sent on every discovery tick
   * so that peers discovered *after* login (or peers that were briefly
   * unreachable) still learn we're online without requiring an app restart. */
  private lastUserId: UserId | null = null;
  private lastStatus: PresenceStatus | null = null;

  constructor(
    private readonly db: DatabaseContext,
    private readonly transport: NetworkTransport,
    private readonly deviceId: DeviceId,
    private readonly devicePrivateKey: string,
  ) {}

  setSelfOnline(userId: UserId): void {
    const now = isoNow();
    this.db.connection.exec(
      "UPDATE users SET presence = ?, last_seen_at = ?, updated_at = ? WHERE id = ?",
      [PresenceStatus.Online, now, now, userId],
    );
    this.lastUserId = userId;
    this.lastStatus = PresenceStatus.Online;
    void this.broadcast(userId, PresenceStatus.Online);
  }

  setSelfOffline(userId: UserId): void {
    const now = isoNow();
    this.db.connection.exec(
      "UPDATE users SET presence = ?, last_seen_at = ?, updated_at = ? WHERE id = ?",
      [PresenceStatus.Offline, now, now, userId],
    );
    this.lastUserId = userId;
    this.lastStatus = PresenceStatus.Offline;
    void this.broadcast(userId, PresenceStatus.Offline);
  }

  /** Re-sends the last known local status to all currently known peers.
   * Call this on every peer-discovery tick — cheap no-op if nothing changed,
   * but ensures peers that appear on the LAN after login (or reconnect after
   * a drop) converge on the correct presence within one discovery interval. */
  announceToPeers(): void {
    if (!this.lastUserId || !this.lastStatus) return;
    void this.broadcast(this.lastUserId, this.lastStatus);
  }

  applyRemote(payload: PresenceUpdatePayload): void {
    this.db.connection.exec(
      "UPDATE users SET presence = ?, last_seen_at = ?, updated_at = ? WHERE id = ?",
      [payload.status, payload.at, payload.at, payload.userId],
    );
  }

  private async broadcast(userId: UserId, status: PresenceStatus): Promise<void> {
    const payload: PresenceUpdatePayload = {
      userId,
      status,
      at: isoNow(),
    };
    const envelope = createEnvelope({
      messageType: "presence.update",
      messageId: messageId(),
      senderDeviceId: this.deviceId,
      nonce: randomNonce(),
      payload,
    });
    envelope.signature = await cryptoSignEnvelope(this.devicePrivateKey, envelope);
    for (const peer of this.transport.getPeers()) {
      try {
        await this.transport.send(peer.deviceId, envelope);
      } catch {
        /* offline peer */
      }
    }
  }
}
