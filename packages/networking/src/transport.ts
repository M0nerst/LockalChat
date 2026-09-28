import type { ProtocolEnvelope } from "@lockal/shared";

export interface PeerInfo {
  deviceId: string;
  userId?: string;
  publicKey: string;
  addresses: string[];
  lastSeenAt: string;
  trusted: boolean;
}

export interface NetworkTransport {
  readonly kind: "lan" | "wifi-direct" | "bluetooth" | "internet";

  discoverPeers(): Promise<void>;
  getPeers(): PeerInfo[];
  connect(peerDeviceId: string): Promise<void>;
  disconnect(peerDeviceId: string): Promise<void>;
  send(peerDeviceId: string, envelope: ProtocolEnvelope): Promise<void>;
  onReceive(handler: (peerDeviceId: string, envelope: ProtocolEnvelope) => void): () => void;
  sendStream?(
    peerDeviceId: string,
    streamId: string,
    chunk: Uint8Array,
    meta: Record<string, string>,
  ): Promise<void>;
}
