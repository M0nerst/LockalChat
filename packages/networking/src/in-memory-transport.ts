import type { ProtocolEnvelope } from "@lockal/shared";
import type { NetworkTransport, PeerInfo } from "./transport.js";

/** Test double linking two transports */
export class InMemoryTransport implements NetworkTransport {
  readonly kind = "lan" as const;
  private static registry = new Map<string, InMemoryTransport>();
  private handlers = new Set<(peer: string, env: ProtocolEnvelope) => void>();
  private online = true;

  constructor(readonly localDeviceId: string, readonly peerInfo: PeerInfo) {
    InMemoryTransport.registry.set(localDeviceId, this);
  }

  setOnline(value: boolean): void {
    this.online = value;
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
    const target = InMemoryTransport.registry.get(peerDeviceId);
    if (!target) throw new Error("peer not found");
    for (const h of target.handlers) {
      h(this.localDeviceId, envelope);
    }
  }

  onReceive(handler: (peerDeviceId: string, envelope: ProtocolEnvelope) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
