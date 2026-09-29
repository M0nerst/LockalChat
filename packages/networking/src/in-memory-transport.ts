import type { ProtocolEnvelope } from "@lockal/shared";
import type { NetworkTransport, PeerInfo } from "./transport.js";

/** Test double linking two transports */
export class InMemoryTransport implements NetworkTransport {
  readonly kind = "lan" as const;
  private static registry = new Map<string, InMemoryTransport>();
  private handlers = new Set<(peer: string, env: ProtocolEnvelope) => void>();
  private online = true;
  private blocked = new Set<string>();

  constructor(readonly localDeviceId: string, readonly peerInfo: PeerInfo) {
    InMemoryTransport.registry.set(localDeviceId, this);
  }

  setOnline(value: boolean): void {
    this.online = value;
  }

  /** Direct sends to this device fail. Another peer can still forward to it. */
  blockPeer(deviceId: string): void {
    this.blocked.add(deviceId);
  }

  static link(a: InMemoryTransport, b: InMemoryTransport): void {
    a.peerInfo.trusted = true;
    b.peerInfo.trusted = true;
  }

  async discoverPeers(): Promise<void> {}

  getPeers(): PeerInfo[] {
    return [...InMemoryTransport.registry.values()]
      .filter((t) => t.localDeviceId !== this.localDeviceId)
      .map((t) => t.peerInfo);
  }

  async connect(_peerDeviceId: string): Promise<void> {}

  async disconnect(_peerDeviceId: string): Promise<void> {}

  async send(peerDeviceId: string, envelope: ProtocolEnvelope): Promise<void> {
    if (!this.online) throw new Error("offline");
    if (this.blocked.has(peerDeviceId)) throw new Error("peer not connected");
    const target = InMemoryTransport.registry.get(peerDeviceId);
    if (!target) throw new Error("peer not found");
    // The daemon re-serializes every frame. Undefined payload fields disappear
    // here the same way, so tests catch signatures that only match in-process.
    const relayed = JSON.parse(JSON.stringify(envelope)) as ProtocolEnvelope;
    for (const h of target.handlers) {
      h(this.localDeviceId, relayed);
    }
  }

  onReceive(handler: (peerDeviceId: string, envelope: ProtocolEnvelope) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
