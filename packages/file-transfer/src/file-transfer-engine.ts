import { randomNonce, signEnvelope as cryptoSignEnvelope } from "@lockal/crypto";
import type { DatabaseContext } from "@lockal/database";
import type { User } from "@lockal/domain";
import type { UserId } from "@lockal/shared";
import { MessageDeliveryStatus } from "@lockal/domain";
import { ChatService } from "@lockal/messaging";
import type { NetworkTransport } from "@lockal/networking";
import {
  createEnvelope,
  generateId,
  isoNow,
  messageId,
  type DeviceId,
  type ProtocolEnvelope,
} from "@lockal/shared";
import type { BlobStore } from "./blob-store.js";
import {
  base64ToBytes,
  DEFAULT_CHUNK_SIZE,
  readFileChunkBase64,
  sha256HexOfFile,
} from "./hash-stream.js";
import type {
  FileChunkPayload,
  FileCompletePayload,
  FileMetaPayload,
  FileRelayPayload,
  FileResumePayload,
} from "./payloads.js";
import { TransferRepository } from "./transfer-repository.js";

export interface FileTransferEngineContext {
  deviceId: DeviceId;
  devicePrivateKey: string;
  userId: UserId;
}

export class FileTransferEngine {
  private readonly transfers: TransferRepository;
  private readonly chats: ChatService;
  private receiveBuffers = new Map<string, Blob[]>();
  /** Chunks that arrived before file.meta created the transfer row. */
  private earlyChunks = new Map<string, FileChunkPayload[]>();
  /** Transfers where every chunk reached at least one live peer. */
  private fullyDelivered = new Set<string>();
  /** A chunk was dropped after retries. The file must not be shown as sent. */
  private abandoned = new Set<string>();
  /** Send loop still running. The periodic outbox flush must not mark it done. */
  private sendingNow = new Set<string>();
  /** Chunk indexes that already reached at least one other computer. */
  private reachedChunks = new Map<string, Set<number>>();
  /** Devices that did not accept a frame quickly. Later chunks skip them. */
  private slowDevices = new Set<string>();
  private static readonly MAX_CHUNK_ATTEMPTS = 30;

  constructor(
    private readonly db: DatabaseContext,
    private readonly transport: NetworkTransport,
    private readonly blobStore: BlobStore,
    private readonly ctx: FileTransferEngineContext,
  ) {
    this.transfers = new TransferRepository(db);
    this.chats = new ChatService(db);
  }

  async sendFile(input: {
    file: Blob;
    fileName: string;
    mimeType: string;
    chatId: string;
    sender: User;
    recipientUserId: UserId;
  }): Promise<{ transferId: string; messageId: string }> {
    const chunkSize = DEFAULT_CHUNK_SIZE;
    const sha256Hex = await sha256HexOfFile(input.file, chunkSize);
    const totalChunks = Math.ceil(input.file.size / chunkSize) || 1;
    const transferId = generateId("xfr");
    const msgId = messageId();

    this.transfers.create({
      id: transferId,
      chatId: input.chatId as never,
      messageId: msgId,
      senderUserId: input.sender.id,
      senderDeviceId: this.ctx.deviceId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.file.size,
      sha256Hex,
      chunkSize,
      totalChunks,
      status: "sending",
    });

    await this.blobStore.put(transferId, input.file);

    this.db.connection.exec(
      `INSERT INTO messages (
        id, chat_id, sender_user_id, sender_device_id, content_type, content_text,
        reply_to_id, status, client_nonce, sequence_num, created_at, edited_at, deleted_at
      ) VALUES (?, ?, ?, ?, 'file', ?, NULL, ?, ?, 0, ?, NULL, NULL)`,
      [
        msgId,
        input.chatId,
        input.sender.id,
        this.ctx.deviceId,
        input.fileName,
        MessageDeliveryStatus.Sending,
        transferId,
        isoNow(),
      ],
    );
    this.chats.touchChat(input.chatId as never);
    this.transfers.linkAttachment(msgId, transferId, transferId);

    await this.transport.discoverPeers();
    if (this.collectTargetDevices(input.recipientUserId, input.chatId).length === 0) {
      this.transfers.setStatus(transferId, "failed");
      this.chats.getMessageRepository().updateStatus(msgId, MessageDeliveryStatus.Failed);
      throw new Error(
        "Устройство собеседника не найдено. Проверьте Contacts → LAN peers (connected).",
      );
    }

    await this.deliverOutgoingFile(transferId, input.file, input.recipientUserId, input.chatId);
    return { transferId, messageId: msgId };
  }

  /** Re-sends a file that failed to leave this device (no peer / network).
   * Requires the original blob still be in local storage. */
  async retryFailedTransfer(transferId: string): Promise<void> {
    const tr = this.transfers.get(transferId);
    if (!tr || tr.senderDeviceId !== this.ctx.deviceId) return;
    if (tr.status !== "failed" && tr.status !== "cancelled") return;
    const blob = await this.blobStore.get(transferId);
    if (!blob) {
      throw new Error("Файл больше недоступен на этом устройстве");
    }
    const recipientUserId = this.resolveOtherChatMember(tr.chatId, tr.senderUserId);
    if (!recipientUserId) {
      throw new Error("Собеседник не найден");
    }
    await this.transport.discoverPeers();
    if (this.collectTargetDevices(recipientUserId, tr.chatId).length === 0) {
      throw new Error(
        "Устройство собеседника не найдено. Проверьте Contacts → LAN peers (connected).",
      );
    }
    this.transfers.deletePendingOutbox(transferId);
    this.transfers.updateProgress(transferId, 0, "sending");
    if (tr.messageId) {
      this.chats.getMessageRepository().updateStatus(tr.messageId, MessageDeliveryStatus.Sending);
    }
    await this.deliverOutgoingFile(transferId, blob, recipientUserId, tr.chatId);
  }

  private async deliverOutgoingFile(
    transferId: string,
    file: Blob,
    recipientUserId: UserId,
    chatId?: string,
  ): Promise<void> {
    const tr = this.transfers.get(transferId);
    if (!tr) return;
    const chat = this.chats.getChat(tr.chatId);
    const meta: FileMetaPayload = {
      transferId,
      chatId: tr.chatId,
      messageId: tr.messageId ?? "",
      fileName: tr.fileName,
      mimeType: tr.mimeType,
      sizeBytes: tr.sizeBytes,
      sha256Hex: tr.sha256Hex,
      chunkSize: tr.chunkSize,
      totalChunks: tr.totalChunks,
    };
    // Only groups carry a roster. Setting `group: undefined` on a direct chat
    // used to be signed and then stripped by JSON, so the peer rejected the file.
    if (chat?.kind === "group") {
      meta.group = {
        title: chat.title ?? "Группа",
        memberUserIds: this.chats.listMemberIds(tr.chatId),
        rosterRevision: this.chats.rosterRevision(tr.chatId),
      };
    }
    const metaEnvelope = await this.signEnvelope("file.meta", meta);
    await this.broadcastToPeers(recipientUserId, metaEnvelope, (deviceId, env) => {
      this.transfers.enqueueChunkOutbox(transferId, -1, deviceId, JSON.stringify(env));
    }, chatId ?? tr.chatId);
    await this.sendChunksFrom(transferId, file, 0, recipientUserId);
  }

  async handleEnvelope(envelope: ProtocolEnvelope): Promise<void> {
    switch (envelope.messageType) {
      case "file.meta":
        await this.handleMeta(envelope.payload as FileMetaPayload, envelope.senderDeviceId as DeviceId);
        break;
      case "file.chunk":
        await this.handleChunk(envelope.payload as FileChunkPayload);
        break;
      case "file.complete":
        await this.handleComplete(envelope.payload as FileCompletePayload);
        break;
      case "file.resume":
        await this.handleResume(envelope.payload as FileResumePayload, envelope.senderDeviceId);
        break;
      case "file.relay":
        await this.handleRelay(envelope.payload as FileRelayPayload);
        break;
      default:
        break;
    }
  }

  /** Pauses an outgoing transfer we control: stops the in-flight chunk loop (checked
   * every iteration) and prevents the periodic outbox flush from resending its chunks
   * until resumeTransfer() is called. No-op for transfers we don't own or that are
   * already finished. */
  pauseTransfer(transferId: string): void {
    const tr = this.transfers.get(transferId);
    if (!tr || tr.senderDeviceId !== this.ctx.deviceId) return;
    if (tr.status !== "sending" && tr.status !== "pending") return;
    this.transfers.setStatus(transferId, "paused");
  }

  /** Resumes a transfer:
   * - if we're the sender of a paused upload, continues sending remaining chunks;
   * - if we're the receiver of a stalled/incomplete download, asks the sender to
   *   resend from our current `nextChunkIndex` via a `file.resume` envelope. */
  async resumeTransfer(transferId: string): Promise<void> {
    const tr = this.transfers.get(transferId);
    if (!tr) return;
    if (tr.senderDeviceId === this.ctx.deviceId) {
      if (tr.status !== "paused") return;
      this.transfers.setStatus(transferId, "sending");
      this.transfers.resetPendingRetry(transferId);
      const blob = await this.blobStore.get(transferId);
      if (!blob) return;
      const recipientUserId = this.resolveOtherChatMember(tr.chatId, tr.senderUserId);
      if (!recipientUserId) return;
      await this.sendChunksFrom(transferId, blob, tr.nextChunkIndex, recipientUserId);
    } else {
      if (tr.status === "completed" || tr.status === "cancelled") return;
      this.transfers.setStatus(transferId, "receiving");
      const resume: FileResumePayload = { transferId, nextChunkIndex: tr.nextChunkIndex };
      const env = await this.signEnvelope("file.resume", resume);
      try {
        await this.transport.send(tr.senderDeviceId, env);
      } catch {
        /* sender offline — will retry when user presses resume again */
      }
    }
  }

  /** Cancels a transfer in either direction: stops further chunk activity and drops
   * any queued-but-unsent chunk jobs. Already-transferred data/blobs are left in place. */
  cancelTransfer(transferId: string): void {
    const tr = this.transfers.get(transferId);
    if (!tr) return;
    if (tr.status === "completed") return;
    this.transfers.setStatus(transferId, "cancelled");
    this.transfers.deletePendingOutbox(transferId);
    this.receiveBuffers.delete(transferId);
  }

  private resolveOtherChatMember(chatId: string, excludeUserId: string): UserId | null {
    const row = this.db.connection.get<{ user_id: string }>(
      "SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id != ? LIMIT 1",
      [chatId, excludeUserId],
    );
    return (row?.user_id as UserId) ?? null;
  }

  async flushOutbox(): Promise<void> {
    const pending = this.transfers.listPendingChunks();
    for (const item of pending) {
      if (item.attempts >= FileTransferEngine.MAX_CHUNK_ATTEMPTS) {
        this.transfers.markChunkGaveUp(item.id);
        const reached = item.chunkIndex >= 0 && this.reachedChunks.get(item.transferId)?.has(item.chunkIndex);
        if (item.chunkIndex >= 0 && !reached) this.abandoned.add(item.transferId);
        continue;
      }
      try {
        const envelope = await this.envelopeForOutboxItem(item);
        if (!envelope) {
          this.transfers.markChunkGaveUp(item.id);
          continue;
        }
        await this.transport.send(item.targetDeviceId, envelope);
        this.slowDevices.delete(item.targetDeviceId);
        this.transfers.markChunkSent(item.id);
        if (item.chunkIndex >= 0) {
          const tr = this.transfers.get(item.transferId);
          if (tr) {
            const next = Math.max(tr.nextChunkIndex, item.chunkIndex + 1);
            this.transfers.updateProgress(item.transferId, next, tr.status);
          }
        }
      } catch {
        this.transfers.markChunkRetry(item.id, item.attempts);
      }
    }
    const touched = new Set(pending.map((item) => item.transferId));
    for (const transferId of touched) {
      const tr = this.transfers.get(transferId);
      if (!tr || tr.status !== "sending") continue;
      if (this.sendingNow.has(transferId)) continue;
      if (tr.nextChunkIndex < tr.totalChunks) continue;
      if (this.transfers.hasPendingOutbox(transferId)) continue;
      if (this.abandoned.has(transferId)) {
        this.transfers.setStatus(transferId, "failed");
        this.fullyDelivered.delete(transferId);
        this.abandoned.delete(transferId);
        if (tr.messageId) {
          this.db.connection.exec(
            "UPDATE messages SET status = ? WHERE id = ? AND status = ?",
            [MessageDeliveryStatus.Failed, tr.messageId, MessageDeliveryStatus.Sending],
          );
        }
        continue;
      }
      if (this.fullyDelivered.has(transferId) || this.transfers.hasSentChunk(transferId)) {
        this.markTransferSent(transferId, tr.messageId);
      } else {
        this.transfers.setStatus(transferId, "failed");
        if (tr.messageId) {
          this.db.connection.exec(
            "UPDATE messages SET status = ? WHERE id = ? AND status = ?",
            [MessageDeliveryStatus.Failed, tr.messageId, MessageDeliveryStatus.Sending],
          );
        }
      }
    }
  }

  /** Chunk bytes stay in the blob store. The outbox row only remembers who still needs them. */
  private async envelopeForOutboxItem(item: {
    transferId: string;
    chunkIndex: number;
    envelopeJson: string;
  }): Promise<ProtocolEnvelope | null> {
    if (item.chunkIndex < 0) {
      return JSON.parse(item.envelopeJson) as ProtocolEnvelope;
    }
    const tr = this.transfers.get(item.transferId);
    const blob = await this.blobStore.get(item.transferId);
    if (!tr || !blob) return null;
    const dataBase64 = await readFileChunkBase64(blob, item.chunkIndex, tr.chunkSize);
    return this.signEnvelope("file.chunk", {
      transferId: item.transferId,
      chunkIndex: item.chunkIndex,
      dataBase64,
    });
  }

  private markTransferSent(transferId: string, messageId: string | null): void {
    this.transfers.markCompleted(transferId);
    this.fullyDelivered.delete(transferId);
    this.reachedChunks.delete(transferId);
    if (messageId) {
      this.db.connection.exec(
        "UPDATE messages SET status = ? WHERE id = ? AND status = ?",
        [MessageDeliveryStatus.Sent, messageId, MessageDeliveryStatus.Sending],
      );
    }
  }

  private async handleMeta(meta: FileMetaPayload, senderDeviceId: DeviceId): Promise<void> {
    const existing = this.transfers.get(meta.transferId);
    const device = this.db.devices.findById(senderDeviceId);
    const known = this.db.connection.get<{ user_id: string }>(
      "SELECT user_id FROM known_peers WHERE device_id = ?",
      [senderDeviceId],
    );
    const senderUserId = (device?.userId ?? known?.user_id ?? "unknown") as UserId;
    if (!existing) {
      this.transfers.create({
        id: meta.transferId,
        chatId: meta.chatId as never,
        messageId: meta.messageId as never,
        senderUserId,
        senderDeviceId: senderDeviceId,
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
        sha256Hex: meta.sha256Hex,
        chunkSize: meta.chunkSize,
        totalChunks: meta.totalChunks,
        status: "receiving",
      });
      this.receiveBuffers.set(meta.transferId, new Array(meta.totalChunks));
    }
    // Ensure the chat row exists using the *chat id's own* participants — not
    // (senderUserId, ctx.userId), which collapse to the same person when this
    // copy arrives via multi-device sync from one of our own other devices.
    if (
      meta.group &&
      typeof meta.group.title === "string" &&
      Array.isArray(meta.group.memberUserIds) &&
      meta.chatId.startsWith("grp_")
    ) {
      const org = this.db.organizations.getFirst();
      if (org) {
        this.chats.upsertGroupChat({
          organizationId: org.id,
          chatId: meta.chatId as never,
          title: meta.group.title,
          memberUserIds: meta.group.memberUserIds as never,
          updateTitle: false,
          rosterRevision: meta.group.rosterRevision,
        });
      }
    } else {
      this.chats.ensureChatFromDirectId(
        (this.db.organizations.getFirst()?.id ?? "") as never,
        meta.chatId as never,
      );
    }
    const msgExists = this.db.connection.get<{ id: string }>(
      "SELECT id FROM messages WHERE id = ?",
      [meta.messageId],
    );
    if (!msgExists) {
      this.db.connection.exec(
        `INSERT INTO messages (
          id, chat_id, sender_user_id, sender_device_id, content_type, content_text,
          reply_to_id, status, client_nonce, sequence_num, created_at, edited_at, deleted_at
        ) VALUES (?, ?, ?, ?, 'file', ?, NULL, ?, ?, 0, ?, NULL, NULL)`,
        [
          meta.messageId,
          meta.chatId,
          senderUserId,
          senderDeviceId,
          meta.fileName,
          MessageDeliveryStatus.Delivered,
          meta.transferId,
          isoNow(),
        ],
      );
      this.chats.touchChat(meta.chatId as never);
      this.transfers.linkAttachment(meta.messageId as never, meta.transferId, meta.transferId);
    }
    const early = this.earlyChunks.get(meta.transferId) ?? [];
    this.earlyChunks.delete(meta.transferId);
    for (const chunk of early) {
      await this.storeChunk(chunk);
    }
  }

  private async handleChunk(chunk: FileChunkPayload): Promise<void> {
    const tr = this.transfers.get(chunk.transferId);
    if (!tr) {
      const queued = this.earlyChunks.get(chunk.transferId) ?? [];
      queued.push(chunk);
      this.earlyChunks.set(chunk.transferId, queued);
      return;
    }
    await this.storeChunk(chunk);
  }

  private async storeChunk(chunk: FileChunkPayload): Promise<void> {
    const tr = this.transfers.get(chunk.transferId);
    if (!tr) return;
    if (chunk.chunkIndex < 0 || chunk.chunkIndex >= tr.totalChunks) return;
    const parts = this.receiveBuffers.get(chunk.transferId) ?? new Array(tr.totalChunks);
    const chunkBytes = Uint8Array.from(base64ToBytes(chunk.dataBase64));
    parts[chunk.chunkIndex] = new Blob([chunkBytes], { type: tr.mimeType });
    this.receiveBuffers.set(chunk.transferId, parts);
    const done = parts.filter(Boolean).length;
    this.transfers.updateProgress(chunk.transferId, done, "receiving");
    if (done >= tr.totalChunks) {
      await this.finalizeReceive(chunk.transferId, tr);
    }
  }

  private async handleComplete(payload: FileCompletePayload): Promise<void> {
    const tr = this.transfers.get(payload.transferId);
    if (tr && tr.sha256Hex === payload.sha256Hex) {
      this.transfers.markCompleted(payload.transferId);
    }
  }

  private async handleResume(payload: FileResumePayload, peerDeviceId: string): Promise<void> {
    const tr = this.transfers.get(payload.transferId);
    if (!tr || tr.senderDeviceId !== this.ctx.deviceId) return;
    if (tr.status !== "sending" && tr.status !== "completed") return;
    const blob = await this.blobStore.get(payload.transferId);
    if (!blob) return;
    const device = this.db.devices.findById(peerDeviceId as DeviceId);
    const recipientUserId = device?.userId as UserId | undefined;
    if (!recipientUserId) return;
    await this.sendChunksFrom(payload.transferId, blob, payload.nextChunkIndex, recipientUserId);
    void peerDeviceId;
  }

  private async finalizeReceive(transferId: string, tr: NonNullable<ReturnType<TransferRepository["get"]>>): Promise<void> {
    const parts = this.receiveBuffers.get(transferId) ?? [];
    if (parts.length !== tr.totalChunks || parts.some((part) => !part)) {
      this.transfers.updateProgress(transferId, tr.nextChunkIndex, "failed");
      return;
    }
    const blob = new Blob(parts, { type: tr.mimeType });
    const hash = await sha256HexOfFile(blob);
    if (hash !== tr.sha256Hex) {
      this.transfers.updateProgress(transferId, tr.nextChunkIndex, "failed");
      return;
    }
    await this.blobStore.put(transferId, blob);
    this.transfers.markCompleted(transferId);
    this.receiveBuffers.delete(transferId);
    if (tr.messageId) {
      this.db.connection.exec("UPDATE messages SET status = ? WHERE id = ?", [
        MessageDeliveryStatus.Delivered,
        tr.messageId,
      ]);
    }
    const complete: FileCompletePayload = { transferId, sha256Hex: tr.sha256Hex };
    const env = await this.signEnvelope("file.complete", complete);
    await this.broadcastToPeers(tr.senderUserId, env, () => {});
  }

  private async sendChunksFrom(
    transferId: string,
    file: Blob,
    fromIndex: number,
    recipientUserId: UserId,
  ): Promise<void> {
    const tr = this.transfers.get(transferId);
    if (!tr) return;
    const sendingRange = fromIndex < tr.totalChunks;
    let live = sendingRange;
    this.sendingNow.add(transferId);
    try {
      for (let i = fromIndex; i < tr.totalChunks; i++) {
        const current = this.transfers.get(transferId);
        if (!current || current.status === "paused" || current.status === "cancelled") return;
        const dataBase64 = await readFileChunkBase64(file, i, tr.chunkSize);
        const chunk: FileChunkPayload = { transferId, chunkIndex: i, dataBase64 };
        const env = await this.signEnvelope("file.chunk", chunk);
        const delivered = await this.broadcastToPeers(
          recipientUserId,
          env,
          (deviceId) => {
            this.transfers.enqueueChunkOutbox(transferId, i, deviceId, "{}");
          },
          tr.chatId,
        );
        if (delivered === 0) live = false;
        else {
          const reached = this.reachedChunks.get(transferId) ?? new Set<number>();
          reached.add(i);
          this.reachedChunks.set(transferId, reached);
        }
        this.transfers.updateProgress(transferId, i + 1, "sending");
        // Let chat and presence use the socket between chunks.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      this.sendingNow.delete(transferId);
      if (live) this.fullyDelivered.add(transferId);
      await this.flushOutbox();
      const finalStatus = this.transfers.get(transferId)?.status;
      if (
        finalStatus === "paused" ||
        finalStatus === "cancelled" ||
        finalStatus === "failed" ||
        finalStatus === "completed"
      ) {
        return;
      }
      if (this.abandoned.has(transferId)) return;
      if (
        this.fullyDelivered.has(transferId) ||
        (!this.transfers.hasPendingOutbox(transferId) && this.transfers.hasSentChunk(transferId))
      ) {
        this.markTransferSent(transferId, tr.messageId);
      }
    } finally {
      this.sendingNow.delete(transferId);
    }
  }

  private collectTargetDevices(recipientUserId: UserId, chatId?: string): DeviceId[] {
    return this.collectTargets(recipientUserId, chatId).map((target) => target.deviceId);
  }

  /** Connected devices first, and the person we're writing to before our own other computers. */
  private collectTargets(
    recipientUserId: UserId,
    chatId?: string,
  ): Array<{ deviceId: DeviceId; userId: string; connected: boolean }> {
    const org = this.db.organizations.getFirst();
    if (!org) return [];
    const targetUserIds = new Set<string>([recipientUserId, this.ctx.userId]);
    if (chatId) {
      for (const row of this.db.connection.all<{ user_id: string }>(
        "SELECT user_id FROM chat_members WHERE chat_id = ?",
        [chatId],
      )) {
        targetUserIds.add(row.user_id);
      }
    }
    const byDevice = new Map<string, string>();
    for (const d of this.db.devices.listByOrganization(org.id)) {
      if (targetUserIds.has(d.userId) && d.id !== this.ctx.deviceId) byDevice.set(d.id, d.userId);
    }
    for (const p of this.transport.getPeers()) {
      if (p.userId && targetUserIds.has(p.userId) && p.deviceId !== this.ctx.deviceId) {
        if (!byDevice.has(p.deviceId)) byDevice.set(p.deviceId, p.userId);
      }
    }
    for (const row of this.db.connection.all<{ device_id: string; user_id: string }>(
      "SELECT device_id, user_id FROM known_peers WHERE organization_id = ?",
      [org.id],
    )) {
      if (targetUserIds.has(row.user_id) && row.device_id !== this.ctx.deviceId && !byDevice.has(row.device_id)) {
        byDevice.set(row.device_id, row.user_id);
      }
    }
    const connected = new Set(
      this.transport.getPeers().filter((peer) => peer.trusted).map((peer) => peer.deviceId),
    );
    const targets = [...byDevice.entries()].map(([deviceId, userId]) => ({
      deviceId: deviceId as DeviceId,
      userId,
      connected: connected.has(deviceId),
    }));
    const rank = (userId: string) => (userId === recipientUserId ? 0 : userId === this.ctx.userId ? 2 : 1);
    targets.sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      return rank(a.userId) - rank(b.userId);
    });
    return targets;
  }

  private async sendToDevice(
    deviceId: DeviceId,
    envelope: ProtocolEnvelope,
  ): Promise<"ok" | "fail"> {
    try {
      await this.transport.send(deviceId, envelope);
      return "ok";
    } catch {
      return "fail";
    }
  }

  /** Ask one other online computer to pass the frame on, when nobody in the chat accepted it. */
  private async relayViaOtherPeer(
    targetDeviceIds: DeviceId[],
    envelope: ProtocolEnvelope,
  ): Promise<boolean> {
    if (envelope.messageType === "file.relay") return false;
    if (targetDeviceIds.length === 0 || targetDeviceIds.length > 16) return false;
    const taken = new Set<string>(targetDeviceIds);
    const relay = this.transport.getPeers().find(
      (peer) => peer.trusted && peer.deviceId !== this.ctx.deviceId && !taken.has(peer.deviceId),
    );
    if (!relay) return false;
    const wrapper = await this.signEnvelope("file.relay", {
      targetDeviceIds,
      envelope,
    } satisfies FileRelayPayload);
    try {
      await this.transport.send(relay.deviceId as DeviceId, wrapper);
      return true;
    } catch {
      return false;
    }
  }

  private async handleRelay(payload: FileRelayPayload): Promise<void> {
    const inner = payload?.envelope;
    const targets = Array.isArray(payload?.targetDeviceIds) ? payload.targetDeviceIds.slice(0, 16) : [];
    if (!inner || targets.length === 0) return;
    const kind = inner.messageType;
    if (kind !== "file.meta" && kind !== "file.chunk" && kind !== "file.complete" && kind !== "file.resume") {
      return;
    }
    for (const deviceId of targets) {
      if (deviceId === this.ctx.deviceId) continue;
      try {
        await this.transport.send(deviceId as DeviceId, inner);
      } catch {
        /* the sender keeps a direct retry for this device */
      }
    }
  }

  private async broadcastToPeers(
    recipientUserId: UserId,
    envelope: ProtocolEnvelope,
    onQueue: (deviceId: DeviceId, env: ProtocolEnvelope) => void,
    chatId?: string,
  ): Promise<number> {
    const targets = this.collectTargets(recipientUserId, chatId);
    if (targets.length === 0) {
      const org = this.db.organizations.getFirst();
      if (org) {
        for (const d of this.db.devices.listByOrganization(org.id)) {
          if (d.id !== this.ctx.deviceId) onQueue(d.id, envelope);
        }
      }
      return 0;
    }
    const someoneConnected = targets.some((target) => target.connected);
    const pool = someoneConnected ? targets.filter((target) => target.connected) : targets;
    const deferred = someoneConnected ? targets.filter((target) => !target.connected) : [];
    for (const target of deferred) onQueue(target.deviceId, envelope);

    const ready = pool.filter((target) => !this.slowDevices.has(target.deviceId));
    for (const target of pool) {
      if (this.slowDevices.has(target.deviceId)) onQueue(target.deviceId, envelope);
    }

    let delivered = 0;
    let deliveredToOthers = 0;
    await Promise.all(
      ready.map(async (target) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), 800);
        });
        const outcome = await Promise.race([
          this.sendToDevice(target.deviceId, envelope).finally(() => clearTimeout(timer)),
          timeout,
        ]);
        if (outcome === "ok") {
          delivered++;
          if (target.userId !== this.ctx.userId) deliveredToOthers++;
          return;
        }
        if (outcome === "timeout") this.slowDevices.add(target.deviceId);
        onQueue(target.deviceId, envelope);
      }),
    );

    if (deliveredToOthers === 0) {
      const relayed = await this.relayViaOtherPeer(
        targets.map((target) => target.deviceId),
        envelope,
      );
      if (relayed) delivered++;
    }
    return delivered;
  }

  private async signEnvelope(messageType: ProtocolEnvelope["messageType"], payload: unknown) {
    const body = createEnvelope({
      messageType,
      messageId: messageId(),
      senderDeviceId: this.ctx.deviceId,
      nonce: randomNonce(),
      payload,
    });
    body.signature = await cryptoSignEnvelope(this.ctx.devicePrivateKey, body);
    return body;
  }

  getRepository(): TransferRepository {
    return this.transfers;
  }
}
