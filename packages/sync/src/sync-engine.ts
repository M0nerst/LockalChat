import { randomNonce, signEnvelope as cryptoSignEnvelope } from "@lockal/crypto";
import type { DatabaseContext } from "@lockal/database";
import { MessageDeliveryStatus } from "@lockal/domain";
import type { ChatMessagePayload, ChatAckPayload, DirectorySnapshotPayload, GroupChatPayload } from "@lockal/messaging";
import type { DirectorySyncService } from "./directory-sync.js";
import type { FileTransferEngine } from "@lockal/file-transfer";
import { ChatService } from "@lockal/messaging";
import type { NetworkTransport } from "@lockal/networking";
import {
  createEnvelope,
  type ProtocolEnvelope,
  type MessageId,
  type DeviceId,
  isoNow,
  messageId,
} from "@lockal/shared";
import { EnvelopeGuard } from "./envelope-guard.js";

export interface SyncEngineContext {
  organizationId: string;
  deviceId: DeviceId;
  userId: string;
  devicePrivateKey: string;
}

export class SyncEngine {
  private readonly chats: ChatService;
  private readonly guard: EnvelopeGuard;
  private unsub: (() => void) | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: DatabaseContext,
    private readonly transport: NetworkTransport,
    private readonly ctx: SyncEngineContext,
    private readonly directorySync: DirectorySyncService | null = null,
    private readonly fileTransfer: FileTransferEngine | null = null,
    private readonly onPersist: (() => void) | null = null,
  ) {
    this.chats = new ChatService(db);
    this.guard = new EnvelopeGuard(db);
  }

  start(): void {
    this.unsub = this.transport.onReceive((peerDeviceId, envelope) => {
      void this.handleIncoming(peerDeviceId, envelope);
    });
    this.flushTimer = setInterval(() => {
      void this.flushOutbox();
    }, 2000);
    void this.transport.discoverPeers();
  }

  stop(): void {
    this.unsub?.();
    if (this.flushTimer) clearInterval(this.flushTimer);
  }

  async publishChatMessage(message: {
    id: MessageId;
    chatId: string;
    senderUserId: string;
    content: string;
    clientNonce: string;
    createdAt: string;
    recipientUserId?: string;
  }): Promise<void> {
    const payload: ChatMessagePayload = {
      messageId: message.id,
      chatId: message.chatId,
      senderUserId: message.senderUserId,
      content: message.content,
      contentType: "text",
      clientNonce: message.clientNonce,
      sentAt: message.createdAt,
    };
    const chat = this.chats.getChat(message.chatId as never);
    if (chat?.kind === "group") {
      payload.group = {
        title: chat.title ?? "Группа",
        memberUserIds: this.chats.listMemberIds(message.chatId as never),
        rosterRevision: this.chats.rosterRevision(message.chatId as never),
      };
    }
    await this.transport.discoverPeers();
    const envelope = await this.buildEnvelope("chat.message", payload);
    const repo = this.chats.getMessageRepository();
    const targetDeviceIds = this.resolveRecipientDeviceIds(
      message.chatId,
      message.recipientUserId,
    );
    if (targetDeviceIds.length === 0) {
      repo.updateStatus(message.id, MessageDeliveryStatus.Failed);
      throw new Error(
        message.recipientUserId
          ? "Устройство собеседника не найдено. Проверьте Contacts → LAN peers (connected) и обновите страницу."
          : "Устройства участников группы не найдены. Проверьте, что они в сети (Контакты → LAN).",
      );
    }
    let delivered = false;
    for (const deviceId of targetDeviceIds) {
      try {
        await this.transport.send(deviceId, envelope);
        delivered = true;
      } catch {
        repo.enqueueOutbox(message.id, deviceId as DeviceId, JSON.stringify(envelope));
      }
    }
    this.chats.getMessageRepository().updateStatus(
      message.id,
      delivered ? MessageDeliveryStatus.Sent : MessageDeliveryStatus.Sending,
    );
  }

  async publishGroupChat(chatId: string, alsoNotifyUserIds: string[] = []): Promise<void> {
    const chat = this.chats.getChat(chatId as never);
    if (!chat || chat.kind !== "group") return;
    const members = this.chats.listMemberIds(chatId as never);
    const payload: GroupChatPayload = {
      chatId,
      title: chat.title ?? "Группа",
      memberUserIds: members,
      createdAt: isoNow(),
      rosterRevision: this.chats.rosterRevision(chatId as never),
    };
    await this.transport.discoverPeers();
    const envelope = await this.buildEnvelope("chat.group", payload);
    const repo = this.chats.getMessageRepository();
    const audience = new Set<string>([...members, ...alsoNotifyUserIds, this.ctx.userId]);
    const targets = this.resolveDeviceIdsForUsers(audience);
    if (targets.length === 0) {
      repo.enqueueSyncOutbox("", JSON.stringify(envelope));
      return;
    }
    for (const deviceId of targets) {
      try {
        await this.transport.send(deviceId as DeviceId, envelope);
      } catch {
        repo.enqueueSyncOutbox(deviceId, JSON.stringify(envelope));
      }
    }
  }

  /** Re-sends a text message that never left this device (status Failed or
   * still Sending). Used from the chat bubble's retry click. */
  async retryChatMessage(messageId: MessageId, recipientUserId?: string): Promise<void> {
    const repo = this.chats.getMessageRepository();
    const msg = repo.findById(messageId);
    if (!msg || msg.contentType !== "text") return;
    repo.updateStatus(messageId, MessageDeliveryStatus.Sending);
    await this.publishChatMessage({
      id: msg.id,
      chatId: msg.chatId,
      senderUserId: msg.senderUserId,
      content: msg.contentText,
      clientNonce: msg.clientNonce,
      createdAt: msg.createdAt,
      recipientUserId,
    });
  }

  /** Sends `chat.ack` with status "read" for each incoming message the local
   * user just opened. Failures are ignored — the next time the chat is
   * opened we won't re-ack those ids (last_read_at already advanced). */
  async publishReadReceipts(
    messages: Array<{
      id: MessageId;
      chatId: string;
      senderDeviceId: DeviceId;
      senderUserId: string;
    }>,
  ): Promise<void> {
    for (const msg of messages) {
      const targets = new Set<string>([msg.senderDeviceId]);
      for (const d of this.db.devices.listByOrganization(this.ctx.organizationId as never)) {
        if (d.userId === msg.senderUserId && d.id !== this.ctx.deviceId) {
          targets.add(d.id);
        }
      }
      const ackPayload: ChatAckPayload = {
        messageId: msg.id,
        chatId: msg.chatId,
        status: "read",
        at: isoNow(),
      };
      const ack = await this.buildEnvelope("chat.ack", ackPayload);
      for (const deviceId of targets) {
        if (deviceId === this.ctx.deviceId) continue;
        try {
          await this.transport.send(deviceId as DeviceId, ack);
        } catch {
          /* peer offline — receipt will simply not land this time */
        }
      }
    }
  }

  private resolveRecipientDeviceIds(chatId: string, recipientUserId?: string): string[] {
    // Always include our own account: this fans the message out to the sender's
    // *other* trusted devices too (multi-device sync), while `d.id !== this.ctx.deviceId`
    // below still excludes the device we're sending from.
    const recipientIds = new Set<string>([this.ctx.userId]);
    if (recipientUserId) {
      recipientIds.add(recipientUserId);
    } else {
      for (const row of this.db.connection.all<{ user_id: string }>(
        "SELECT user_id FROM chat_members WHERE chat_id = ?",
        [chatId],
      )) {
        recipientIds.add(row.user_id);
      }
    }
    return this.resolveDeviceIdsForUsers(recipientIds);
  }

  private resolveDeviceIdsForUsers(userIds: Iterable<string>): string[] {
    const recipientIds = new Set(userIds);
    const deviceIds = new Set<string>();
    for (const d of this.db.devices.listByOrganization(this.ctx.organizationId as never)) {
      if (recipientIds.has(d.userId) && d.id !== this.ctx.deviceId) {
        deviceIds.add(d.id);
      }
    }
    for (const p of this.transport.getPeers()) {
      if (p.userId && recipientIds.has(p.userId) && p.deviceId !== this.ctx.deviceId) {
        deviceIds.add(p.deviceId);
      }
    }
    for (const row of this.db.connection.all<{ device_id: string; user_id: string }>(
      "SELECT device_id, user_id FROM known_peers WHERE organization_id = ?",
      [this.ctx.organizationId],
    )) {
      if (recipientIds.has(row.user_id) && row.device_id !== this.ctx.deviceId) {
        deviceIds.add(row.device_id);
      }
    }
    return [...deviceIds];
  }

  private async handleIncoming(peerDeviceId: string, envelope: ProtocolEnvelope): Promise<void> {
    if (envelope.senderDeviceId === this.ctx.deviceId) return;
    if (!(await this.guard.accept(envelope))) {
      if (typeof console !== "undefined") {
        console.warn("[lockal] envelope rejected", envelope.messageType, envelope.senderDeviceId);
      }
      return;
    }
    switch (envelope.messageType) {
      case "chat.message":
        await this.handleChatMessage(envelope);
        break;
      case "chat.group":
        this.handleGroupChat(envelope.payload as GroupChatPayload);
        break;
      case "chat.ack":
        this.handleAck(envelope.payload as ChatAckPayload);
        break;
      case "presence.update": {
        const p = envelope.payload as { userId: string; status: string; at: string };
        this.db.connection.exec(
          "UPDATE users SET presence = ?, last_seen_at = ?, updated_at = ? WHERE id = ?",
          [p.status, p.at, p.at, p.userId],
        );
        break;
      }
      case "sync.envelope": {
        const body = envelope.payload as { kind?: string; data?: DirectorySnapshotPayload };
        if (body.kind === "directory.snapshot" && body.data) {
          this.directorySync?.applyDirectorySnapshot(body.data);
          this.onPersist?.();
        }
        break;
      }
      case "file.meta":
      case "file.chunk":
      case "file.complete":
      case "file.resume":
      case "file.relay":
        await this.fileTransfer?.handleEnvelope(envelope);
        this.onPersist?.();
        break;
      default:
        break;
    }
    void peerDeviceId;
  }

  private handleGroupChat(payload: GroupChatPayload): void {
    if (
      !payload?.chatId?.startsWith("grp_") ||
      typeof payload.title !== "string" ||
      !Array.isArray(payload.memberUserIds)
    ) {
      return;
    }
    this.chats.upsertGroupChat({
      organizationId: this.ctx.organizationId as never,
      chatId: payload.chatId as never,
      title: payload.title,
      memberUserIds: payload.memberUserIds as never,
      createdAt: payload.createdAt,
      rosterRevision: payload.rosterRevision,
    });
    this.onPersist?.();
  }

  private async handleChatMessage(envelope: ProtocolEnvelope): Promise<void> {
    const payload = envelope.payload as ChatMessagePayload;
    if (
      payload.group &&
      typeof payload.group.title === "string" &&
      Array.isArray(payload.group.memberUserIds) &&
      payload.chatId.startsWith("grp_")
    ) {
      this.chats.upsertGroupChat({
        organizationId: this.ctx.organizationId as never,
        chatId: payload.chatId as never,
        title: payload.group.title,
        memberUserIds: payload.group.memberUserIds as never,
        updateTitle: false,
        rosterRevision: payload.group.rosterRevision,
      });
    } else {
      this.chats.ensureChatFromDirectId(this.ctx.organizationId as never, payload.chatId as never);
    }
    const repo = this.chats.getMessageRepository();
    if (repo.existsByNonce(payload.chatId as never, payload.clientNonce)) {
      return;
    }
    repo.insert({
      id: payload.messageId as MessageId,
      chatId: payload.chatId as never,
      senderUserId: payload.senderUserId as never,
      senderDeviceId: envelope.senderDeviceId as DeviceId,
      contentType: payload.contentType,
      contentText: payload.content,
      status: MessageDeliveryStatus.Delivered,
      clientNonce: payload.clientNonce,
      createdAt: payload.sentAt,
    });
    this.chats.touchChat(payload.chatId as never, payload.sentAt);
    this.onPersist?.();
    const ackPayload: ChatAckPayload = {
      messageId: payload.messageId,
      chatId: payload.chatId,
      status: "delivered",
      at: isoNow(),
    };
    const ack = await this.buildEnvelope("chat.ack", ackPayload);
    try {
      await this.transport.send(envelope.senderDeviceId, ack);
    } catch {
      /* peer offline */
    }
  }

  private handleAck(payload: ChatAckPayload): void {
    const repo = this.chats.getMessageRepository();
    const existing = repo.findById(payload.messageId as MessageId);
    if (existing?.status === MessageDeliveryStatus.Read) return;
    const chat = this.chats.getChat(payload.chatId as never);
    // One member opening a group must not mark the message read for everyone.
    const status =
      payload.status === "read" && chat?.kind !== "group"
        ? MessageDeliveryStatus.Read
        : MessageDeliveryStatus.Delivered;
    repo.updateStatus(payload.messageId as MessageId, status);
    this.onPersist?.();
  }

  private static readonly MAX_OUTBOX_ATTEMPTS = 8;

  private async flushOutbox(): Promise<void> {
    await this.flushSyncOutbox();
    const repo = this.chats.getMessageRepository();
    const pending = repo.listPendingOutbox();
    for (const item of pending) {
      if (item.attempts >= SyncEngine.MAX_OUTBOX_ATTEMPTS) {
        repo.markOutboxFailed(item.id);
        if (!repo.hasPendingOutbox(item.messageId as MessageId)) {
          const msg = repo.findById(item.messageId as MessageId);
          if (msg?.status === MessageDeliveryStatus.Sending) {
            repo.updateStatus(item.messageId as MessageId, MessageDeliveryStatus.Failed);
          }
        }
        this.onPersist?.();
        continue;
      }
      try {
        const envelope = JSON.parse(item.envelopeJson) as ProtocolEnvelope;
        await this.transport.send(item.targetDeviceId, envelope);
        repo.markOutboxSent(item.id);
        const msg = repo.findById(item.messageId as MessageId);
        if (msg?.status === MessageDeliveryStatus.Sending) {
          repo.updateStatus(item.messageId as MessageId, MessageDeliveryStatus.Sent);
        }
        this.onPersist?.();
      } catch {
        repo.markOutboxRetry(item.id, item.attempts);
      }
    }
    await this.fileTransfer?.flushOutbox();
    await this.transport.discoverPeers();
  }

  private async flushSyncOutbox(): Promise<void> {
    const repo = this.chats.getMessageRepository();
    for (const item of repo.listPendingSyncOutbox()) {
      if (item.attempts >= SyncEngine.MAX_OUTBOX_ATTEMPTS) {
        repo.markSyncOutboxFailed(item.id);
        continue;
      }
      let envelope: ProtocolEnvelope;
      try {
        envelope = JSON.parse(item.envelopeJson) as ProtocolEnvelope;
      } catch {
        repo.markSyncOutboxFailed(item.id);
        continue;
      }
      const targets = item.targetDeviceId
        ? [item.targetDeviceId]
        : this.resolveRecipientDeviceIds((envelope.payload as GroupChatPayload).chatId ?? "");
      if (targets.length === 0) {
        repo.markSyncOutboxRetry(item.id, item.attempts);
        continue;
      }
      let failedSpecific = false;
      for (const deviceId of targets) {
        try {
          await this.transport.send(deviceId as DeviceId, envelope);
        } catch {
          if (item.targetDeviceId) failedSpecific = true;
          else repo.enqueueSyncOutbox(deviceId, item.envelopeJson);
        }
      }
      if (failedSpecific) repo.markSyncOutboxRetry(item.id, item.attempts);
      else repo.markSyncOutboxSent(item.id);
    }
  }

  private async buildEnvelope(messageType: ProtocolEnvelope["messageType"], payload: unknown) {
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
}
