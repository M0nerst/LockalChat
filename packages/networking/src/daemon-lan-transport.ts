import type { ProtocolEnvelope } from "@lockal/shared";
import type { NetworkTransport, PeerInfo } from "./transport.js";

type DaemonPeer = {
  device_id: string;
  user_id: string;
  organization_id: string;
  public_key: string;
  host: string;
  port: number;
};

export class DaemonLanTransport implements NetworkTransport {
  readonly kind = "lan" as const;
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private peers = new Map<string, PeerInfo>();
  private handlers = new Set<(peer: string, env: ProtocolEnvelope) => void>();
  private connected = new Set<string>();
  private sendChain: Promise<void> = Promise.resolve();
  private pendingSend: {
    resolve: () => void;
    reject: (err: Error) => void;
  } | null = null;

  constructor(wsUrl = DaemonLanTransport.defaultWsUrl()) {
    this.wsUrl = wsUrl;
  }

  setWsUrl(url: string): void {
    if (url === this.wsUrl) return;
    this.wsUrl = url;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getWsUrl(): string {
    return this.wsUrl;
  }

  static defaultWsUrl(): string {
    if (typeof localStorage !== "undefined") {
      const custom = localStorage.getItem("lockal.daemonWsUrl");
      if (custom) return custom;
    }
    return "ws://127.0.0.1:39201";
  }

  async connectDaemon(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      ws.onopen = () => {
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => reject(new Error("Не удалось подключиться к локальному сетевому сервису"));
      ws.onmessage = (evt) => this.handleMessage(String(evt.data));
      ws.onclose = () => {
        this.ws = null;
        if (this.pendingSend) {
          this.pendingSend.reject(new Error("Соединение с LAN-сервисом разорвано"));
          this.pendingSend = null;
        }
      };
    });
  }

  private handleMessage(raw: string): void {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = data.type;
    if (type === "peers.list.result") {
      const list = (data.peers as DaemonPeer[]) ?? [];
      this.connected = new Set((data.connected as string[]) ?? []);
      this.peers.clear();
      for (const p of list) {
        this.peers.set(p.device_id, {
          deviceId: p.device_id,
          userId: p.user_id,
          publicKey: p.public_key,
          addresses: p.host ? [`${p.host}:${p.port}`] : [],
          lastSeenAt: new Date().toISOString(),
          trusted: this.connected.has(p.device_id),
        });
      }
      return;
    }
    if (type === "envelope.received") {
      const peerDeviceId = String(data.peerDeviceId ?? "");
      const envelope = data.envelope as ProtocolEnvelope;
      for (const h of this.handlers) {
        h(peerDeviceId, envelope);
      }
      return;
    }
    if (type === "envelope.send.result") {
      const pending = this.pendingSend;
      if (pending) {
        this.pendingSend = null;
        if (data.ok) pending.resolve();
        else pending.reject(new Error(String(data.error ?? "send failed")));
      }
    }
  }

  private sendCommand(payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("LAN daemon offline");
    }
    this.ws.send(JSON.stringify(payload));
  }

  async discoverPeers(): Promise<void> {
    await this.connectDaemon().catch(() => undefined);
    try {
      this.sendCommand({ type: "discovery.refresh" });
      this.sendCommand({ type: "peers.list" });
    } catch {
      /* daemon not running */
    }
  }

  getPeers(): PeerInfo[] {
    return [...this.peers.values()];
  }

  async connect(_peerDeviceId: string): Promise<void> {
    await this.discoverPeers();
  }

  async disconnect(_peerDeviceId: string): Promise<void> {}

  async send(peerDeviceId: string, envelope: ProtocolEnvelope): Promise<void> {
    const job = this.sendChain.catch(() => undefined).then(() => this.sendOnce(peerDeviceId, envelope));
    this.sendChain = job.catch(() => undefined);
    return job;
  }

  private async sendOnce(peerDeviceId: string, envelope: ProtocolEnvelope): Promise<void> {
    try {
      await this.connectDaemon();
    } catch (err) {
      this.resetConnection();
      throw err;
    }
    await new Promise<void>((resolve, reject) => {
      const slot = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      this.pendingSend = slot;
      const timer = setTimeout(() => {
        if (this.pendingSend === slot) {
          this.pendingSend = null;
          reject(new Error("LAN send timeout (peer not connected?)"));
        }
      }, 12_000);
      try {
        this.sendCommand({
          type: "envelope.send",
          deviceId: peerDeviceId,
          envelope,
        });
      } catch (err) {
        this.pendingSend = null;
        clearTimeout(timer);
        this.resetConnection();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }).catch((err) => {
      this.resetConnection();
      throw err;
    });
  }

  private resetConnection(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  onReceive(handler: (peerDeviceId: string, envelope: ProtocolEnvelope) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
