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
    if (this.collectTargetDevices(input.recipientUserId).length === 0) {
      this.transfers.setStatus(transferId, "failed");
      this.chats.getMessageRepository().updateStatus(msgId, MessageDeliveryStatus.Failed);
      throw new Error(
        "Устройство собеседника не найдено. Проверьте Contacts → LAN peers (connected).",
      );
    }

    await this.deliverOutgoingFile(transferId, input.file, input.recipientUserId);
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
    if (this.collectTargetDevices(recipientUserId).length === 0) {
      throw new Error(
        "Устройство собеседника не найдено. Проверьте Contacts → LAN peers (connected).",
      );
    }
    this.transfers.deletePendingOutbox(transferId);
    this.transfers.updateProgress(transferId, 0, "sending");
    if (tr.messageId) {
      this.chats.getMessageRepository().updateStatus(tr.messageId, MessageDeliveryStatus.Sending);
    }
    await this.deliverOutgoingFile(transferId, blob, recipientUserId);
  }

  private async deliverOutgoingFile(
    transferId: string,
    file: Blob,
    recipientUserId: UserId,
  ): Promise<void> {
    const tr = this.transfers.get(transferId);
    if (!tr) return;
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
    const metaEnvelope = await this.signEnvelope("file.meta", meta);
    await this.broadcastToPeers(recipientUserId, metaEnvelope, (deviceId, env) => {
      this.transfers.enqueueChunkOutbox(transferId, -1, deviceId, JSON.stringify(env));
    });
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
      try {
        const envelope = JSON.parse(item.envelopeJson) as ProtocolEnvelope;
        await this.transport.send(item.targetDeviceId, envelope);
        this.transfers.markChunkSent(item.id);
        if (item.chunkIndex >= 0) {
          const tr = this.transfers.get(item.transferId);
          if (tr) {
            this.transfers.updateProgress(item.transferId, item.chunkIndex + 1, tr.status);
          }
        }
      } catch {
        this.transfers.markChunkRetry(item.id, item.attempts);
      }
    }
  }

  private async handleMeta(meta: FileMetaPayload, senderDeviceId: DeviceId): Promise<void> {
    const existing = this.transfers.get(meta.transferId);
    const device = this.db.devices.findById(senderDeviceId);
    const senderUserId = (device?.userId ?? "unknown") as UserId;
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
    this.chats.ensureChatFromDirectId(
      (this.db.organizations.getFirst()?.id ?? "") as never,
      meta.chatId as never,
    );
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
  }

  private async handleChunk(chunk: FileChunkPayload): Promise<void> {
    const tr = this.transfers.get(chunk.transferId);
    if (!tr) return;
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
    const blob = new Blob(parts.filter(Boolean) as Blob[], { type: tr.mimeType });
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
    for (let i = fromIndex; i < tr.totalChunks; i++) {
      const current = this.transfers.get(transferId);
      if (!current || current.status === "paused" || current.status === "cancelled") return;
      const dataBase64 = await readFileChunkBase64(file, i, tr.chunkSize);
      const chunk: FileChunkPayload = { transferId, chunkIndex: i, dataBase64 };
      const env = await this.signEnvelope("file.chunk", chunk);
      await this.broadcastToPeers(recipientUserId, env, (deviceId, envelope) => {
        this.transfers.enqueueChunkOutbox(transferId, i, deviceId, JSON.stringify(envelope));
      });
      this.transfers.updateProgress(transferId, i + 1, "sending");
    }
    await this.flushOutbox();
    const finalStatus = this.transfers.get(transferId)?.status;
    if (finalStatus === "paused" || finalStatus === "cancelled") return;
    if (!this.transfers.hasPendingOutbox(transferId)) {
      this.transfers.markCompleted(transferId);
      if (tr.messageId) {
        this.db.connection.exec("UPDATE messages SET status = ? WHERE id = ?", [
          MessageDeliveryStatus.Sent,
          tr.messageId,
        ]);
      }
    }
  }

  private collectTargetDevices(recipientUserId: UserId): DeviceId[] {
    const org = this.db.organizations.getFirst();
    if (!org) return [];
    // Also target our own other devices (multi-device sync) — `d.id !== this.ctx.deviceId`
    // still excludes the device we're sending from.
    const targetUserIds = new Set<string>([recipientUserId, this.ctx.userId]);
    const ids = new Set<string>();
    for (const d of this.db.devices.listByOrganization(org.id)) {
      if (targetUserIds.has(d.userId) && d.id !== this.ctx.deviceId) ids.add(d.id);
    }
    for (const p of this.transport.getPeers()) {
      if (p.userId && targetUserIds.has(p.userId) && p.deviceId !== this.ctx.deviceId) ids.add(p.deviceId);
    }
    for (const row of this.db.connection.all<{ device_id: string; user_id: string }>(
      "SELECT device_id, user_id FROM known_peers WHERE user_id = ? OR user_id = ?",
      [recipientUserId, this.ctx.userId],
    )) {
      if (row.device_id !== this.ctx.deviceId) ids.add(row.device_id);
    }
    return [...ids] as DeviceId[];
  }

  private async broadcastToPeers(
    recipientUserId: UserId,
    envelope: ProtocolEnvelope,
    onQueue: (deviceId: DeviceId, env: ProtocolEnvelope) => void,
  ): Promise<void> {
    await this.transport.discoverPeers();
    const targets = this.collectTargetDevices(recipientUserId);
    if (targets.length === 0) {
      const org = this.db.organizations.getFirst();
      if (org) {
        for (const d of this.db.devices.listByOrganization(org.id)) {
          if (d.id !== this.ctx.deviceId) onQueue(d.id, envelope);
        }
      }
      return;
    }
    for (const deviceId of targets) {
      try {
        await this.transport.send(deviceId, envelope);
      } catch {
        onQueue(deviceId, envelope);
      }
    }
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
