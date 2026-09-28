import { verifyEnvelope } from "@lockal/crypto";
import type { DatabaseContext } from "@lockal/database";
import type { ProtocolEnvelope } from "@lockal/shared";
import { isoNow } from "@lockal/shared";

/** How long we remember a (senderDeviceId, nonce) pair to reject replays.
 * Deliberately long-ish because legitimate messages can sit in the offline
 * outbox for a while before a peer reconnects — we must not confuse a late
 * *first* delivery with a replay of an old one. Pruned lazily on construction. */
const REPLAY_CACHE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class EnvelopeGuard {
  constructor(private readonly db: DatabaseContext) {
    this.pruneOldNonces();
  }

  async accept(envelope: ProtocolEnvelope): Promise<boolean> {
    const verified = await this.verifySignature(envelope);
    if (!verified) return false;
    // Signature alone only proves authenticity/integrity; without this check a
    // captured envelope (e.g. sniffed on the LAN) could be re-sent verbatim
    // later and would still verify. Reject anything we've already processed
    // from this exact sender+nonce pair.
    return this.registerNonceOnce(envelope.senderDeviceId, envelope.nonce);
  }

  private async verifySignature(envelope: ProtocolEnvelope): Promise<boolean> {
    if (envelope.messageType === "sync.envelope") {
      const org = this.db.organizations.getFirst();
      if (!org?.publicKey) return false;
      return verifyEnvelope(org.publicKey, envelope);
    }

    const device = this.db.devices.findById(envelope.senderDeviceId as never);
    if (!device) {
      const peer = this.db.connection.get<{ public_key: string }>(
        "SELECT public_key FROM known_peers WHERE device_id = ?",
        [envelope.senderDeviceId],
      );
      if (!peer?.public_key) return false;
      return verifyEnvelope(peer.public_key, envelope);
    }
    if (device.trustStatus === "revoked") return false;
    return verifyEnvelope(device.publicKey, envelope);
  }

  /** Returns true the first time this (sender, nonce) pair is seen, false on repeats. */
  private registerNonceOnce(senderDeviceId: string, nonce: string): boolean {
    const existing = this.db.connection.get<{ n: number }>(
      "SELECT 1 as n FROM seen_envelopes WHERE sender_device_id = ? AND nonce = ?",
      [senderDeviceId, nonce],
    );
    if (existing) return false;
    this.db.connection.exec(
      "INSERT INTO seen_envelopes (sender_device_id, nonce, seen_at) VALUES (?, ?, ?)",
      [senderDeviceId, nonce, isoNow()],
    );
    return true;
  }

  private pruneOldNonces(): void {
    const cutoff = new Date(Date.now() - REPLAY_CACHE_RETENTION_MS).toISOString();
    this.db.connection.exec("DELETE FROM seen_envelopes WHERE seen_at < ?", [cutoff]);
  }
}
