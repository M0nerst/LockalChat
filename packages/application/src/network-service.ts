import type { SecureStorage } from "@lockal/crypto";
import { DaemonLanTransport } from "@lockal/networking";
import { createBlobStore, FileDownloadService, FileTransferEngine } from "@lockal/file-transfer";
import { DirectorySyncService, SyncEngine } from "@lockal/sync";
import type { DatabaseContext } from "@lockal/database";
import type { AuthContext } from "./auth-service.js";
import { buildDaemonConfig } from "./daemon-config.js";
import { PeerRegistryService } from "./peer-registry-service.js";
import { PresenceService } from "./presence-service.js";
import { ensureDevDaemonRunning } from "./dev-daemon.js";

export class NetworkService {
  readonly transport = new DaemonLanTransport();
  private sync: SyncEngine | null = null;
  private files: FileTransferEngine | null = null;
  private directory: DirectorySyncService | null = null;
  private dirTimer: ReturnType<typeof setInterval> | null = null;
  private peerTimer: ReturnType<typeof setInterval> | null = null;
  private presence: PresenceService | null = null;
  private activeUserId: string | null = null;
  private persistHook: (() => void) | null = null;
  private readonly peerRegistry: PeerRegistryService;

  constructor(
    private readonly db: DatabaseContext,
    private readonly secureStorage: SecureStorage,
  ) {
    this.peerRegistry = new PeerRegistryService(db);
  }

  setPersistHook(hook: () => void): void {
    this.persistHook = hook;
  }

  async start(auth: AuthContext): Promise<void> {
    const privateKey = (await this.secureStorage.get(`device:${auth.device.id}:privateKey`)) ?? "";
    if (!privateKey) {
      throw new Error(
        "Ключ устройства не найден. Выйдите из аккаунта и войдите снова (или создайте организацию заново).",
      );
    }
    const orgPrivateKey =
      (await this.secureStorage.get(`org:${auth.organization.id}:privateKey`)) ??
      this.db.organizations.getEncryptedPrivateKey(auth.organization.id) ??
      "";

    if (orgPrivateKey) {
      await this.secureStorage.set(`org:${auth.organization.id}:privateKey`, orgPrivateKey);
    }

    let lanPort =
      typeof localStorage !== "undefined"
        ? Number(localStorage.getItem("lockal.lanPort") ?? 39200)
        : 39200;
    let uiWsPort =
      typeof localStorage !== "undefined"
        ? Number(localStorage.getItem("lockal.uiWsPort") ?? 39201)
        : 39201;
    let daemonConfig = JSON.stringify(buildDaemonConfig(auth, lanPort, uiWsPort));

    const devDaemon = await ensureDevDaemonRunning(daemonConfig);
    if (devDaemon) {
      lanPort = devDaemon.lanPort;
      uiWsPort = devDaemon.uiWsPort;
      this.transport.setWsUrl(devDaemon.wsUrl);
      daemonConfig = JSON.stringify(buildDaemonConfig(auth, lanPort, uiWsPort));
    }

    if (typeof localStorage !== "undefined") {
      localStorage.setItem("lockal.daemonConfig", daemonConfig);
      localStorage.setItem("lockal.lanPort", String(lanPort));
      localStorage.setItem("lockal.uiWsPort", String(uiWsPort));
      localStorage.setItem("lockal.daemonWsUrl", this.transport.getWsUrl());
    }
    if (typeof globalThis !== "undefined" && "lockalPersistDaemon" in globalThis) {
      await (globalThis as { lockalPersistDaemon?: (c: string) => Promise<void> }).lockalPersistDaemon?.(
        daemonConfig,
      );
    }

    this.directory = orgPrivateKey
      ? new DirectorySyncService(this.db, this.transport, orgPrivateKey, auth.device.id)
      : null;

    this.files = new FileTransferEngine(this.db, this.transport, createBlobStore(), {
      deviceId: auth.device.id,
      devicePrivateKey: privateKey,
      userId: auth.user.id,
    });

    this.sync = new SyncEngine(
      this.db,
      this.transport,
      {
        organizationId: auth.organization.id,
        deviceId: auth.device.id,
        userId: auth.user.id,
        devicePrivateKey: privateKey,
      },
      this.directory,
      this.files,
      () => this.persistHook?.(),
    );
    this.sync.start();

    this.presence = new PresenceService(this.db, this.transport, auth.device.id, privateKey);
    this.activeUserId = auth.user.id;

    // Discover peers *before* the first presence/directory broadcast — sending
    // "online" while getPeers() is still empty means nobody hears it until the
    // next re-announce below, which previously never happened.
    await this.transport.discoverPeers();
    this.peerRegistry.upsertFromDiscovery(
      this.transport.getPeers(),
      auth.organization.id,
    );

    this.presence.setSelfOnline(auth.user.id);

    if (this.directory) {
      void this.directory.broadcastDirectory();
      this.dirTimer = setInterval(() => {
        void this.directory!.broadcastDirectory();
      }, 8000);
    }

    this.peerTimer = setInterval(() => {
      void this.transport.discoverPeers().then(() => {
        const peers = this.transport.getPeers();
        this.peerRegistry.upsertFromDiscovery(peers, auth.organization.id);
        if (peers.length > 0) {
          if (this.directory) void this.directory.broadcastDirectory();
          // Re-announce presence every tick: peers that join the LAN after we
          // logged in (or briefly dropped out) still converge on "online"
          // within one discovery interval instead of staying stuck offline.
          this.presence?.announceToPeers();
        }
      });
    }, 4000);
  }

  stop(): void {
    if (this.presence && this.activeUserId) {
      this.presence.setSelfOffline(this.activeUserId as never);
    }
    this.sync?.stop();
    if (this.dirTimer) clearInterval(this.dirTimer);
    if (this.peerTimer) clearInterval(this.peerTimer);
    this.sync = null;
    this.files = null;
    this.directory = null;
    this.presence = null;
  }

  getSyncEngine(): SyncEngine | null {
    return this.sync;
  }

  getFileTransferEngine(): FileTransferEngine | null {
    return this.files;
  }

  getFileDownloadService(): FileDownloadService {
    return new FileDownloadService(this.db, createBlobStore());
  }

  async syncDirectory(): Promise<void> {
    await this.directory?.broadcastDirectory();
  }
}
