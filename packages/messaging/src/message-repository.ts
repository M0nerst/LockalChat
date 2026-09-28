import type { DatabaseContext } from "@lockal/database";
import { MessageDeliveryStatus } from "@lockal/domain";
import type { ChatId, DeviceId, MessageId, UserId } from "@lockal/shared";
import { generateId, isoNow } from "@lockal/shared";

export interface StoredMessage {
  id: MessageId;
  chatId: ChatId;
  senderUserId: UserId;
  senderDeviceId: DeviceId;
  contentType: string;
  contentText: string;
  status: MessageDeliveryStatus;
  clientNonce: string;
  createdAt: string;
}

export class MessageRepository {
  constructor(private readonly db: DatabaseContext) {}

  insert(message: StoredMessage): void {
    this.db.connection.exec(
      `INSERT INTO messages (
        id, chat_id, sender_user_id, sender_device_id, content_type, content_text,
        reply_to_id, status, client_nonce, sequence_num, created_at, edited_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, NULL, NULL)`,
      [
        message.id,
        message.chatId,
        message.senderUserId,
        message.senderDeviceId,
        message.contentType,
        message.contentText,
        message.status,
        message.clientNonce,
        message.createdAt,
      ],
    );
  }

  existsByNonce(chatId: ChatId, clientNonce: string): boolean {
    const row = this.db.connection.get<{ id: string }>(
      "SELECT id FROM messages WHERE chat_id = ? AND client_nonce = ?",
      [chatId, clientNonce],
    );
    return !!row;
  }

  findById(id: MessageId): StoredMessage | null {
    const row = this.db.connection.get<{
      id: string;
      chat_id: string;
      sender_user_id: string;
      sender_device_id: string;
      content_type: string;
      content_text: string;
      status: string;
      client_nonce: string;
      created_at: string;
    }>("SELECT * FROM messages WHERE id = ?", [id]);
    if (!row) return null;
    return {
      id: row.id as MessageId,
      chatId: row.chat_id as ChatId,
      senderUserId: row.sender_user_id as UserId,
      senderDeviceId: row.sender_device_id as DeviceId,
      contentType: row.content_type,
      contentText: row.content_text,
      status: row.status as MessageDeliveryStatus,
      clientNonce: row.client_nonce,
      createdAt: row.created_at,
    };
  }

  listByChat(chatId: ChatId, limit = 50, before?: string): StoredMessage[] {
    type Row = {
      id: string;
      chat_id: string;
      sender_user_id: string;
      sender_device_id: string;
      content_type: string;
      content_text: string;
      status: string;
      client_nonce: string;
      created_at: string;
    };
    const rows: Row[] = before
      ? this.db.connection.all<Row>(
          "SELECT * FROM messages WHERE chat_id = ? AND created_at < ? ORDER BY created_at DESC, id DESC LIMIT ?",
          [chatId, before, limit],
        )
      : this.db.connection.all<Row>(
          "SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
          [chatId, limit],
        );
    return rows.map((row) => ({
      id: row.id as MessageId,
      chatId: row.chat_id as ChatId,
      senderUserId: row.sender_user_id as UserId,
      senderDeviceId: row.sender_device_id as DeviceId,
      contentType: row.content_type,
      contentText: row.content_text,
      status: row.status as MessageDeliveryStatus,
      clientNonce: row.client_nonce,
      createdAt: row.created_at,
    }));
  }

  updateStatus(id: MessageId, status: MessageDeliveryStatus): void {
    this.db.connection.exec("UPDATE messages SET status = ? WHERE id = ?", [status, id]);
  }

  enqueueOutbox(messageId: MessageId, targetDeviceId: DeviceId, envelopeJson: string): string {
    const id = generateId("obx");
    const now = isoNow();
    this.db.connection.exec(
      `INSERT INTO message_outbox (id, message_id, target_device_id, envelope_json, attempts, next_retry_at, status, created_at)
       VALUES (?, ?, ?, ?, 0, ?, 'pending', ?)`,
      [id, messageId, targetDeviceId, envelopeJson, now, now],
    );
    return id;
  }

  listPendingOutbox(limit = 20): Array<{
    id: string;
    messageId: string;
    targetDeviceId: DeviceId;
    envelopeJson: string;
    attempts: number;
  }> {
    const now = isoNow();
    return this.db.connection
      .all<{
        id: string;
        message_id: string;
        target_device_id: string;
        envelope_json: string;
        attempts: number;
      }>(
        `SELECT id, message_id, target_device_id, envelope_json, attempts FROM message_outbox
         WHERE status = 'pending' AND next_retry_at <= ? ORDER BY created_at LIMIT ?`,
        [now, limit],
      )
      .map((r) => ({
        id: r.id,
        messageId: r.message_id,
        targetDeviceId: r.target_device_id as DeviceId,
        envelopeJson: r.envelope_json,
        attempts: r.attempts,
      }));
  }

  markOutboxSent(id: string): void {
    this.db.connection.exec("UPDATE message_outbox SET status = 'sent' WHERE id = ?", [id]);
  }

  markOutboxRetry(id: string, attempts: number): void {
    const delaySec = Math.min(60, 2 ** attempts);
    const next = new Date(Date.now() + delaySec * 1000).toISOString();
    this.db.connection.exec(
      "UPDATE message_outbox SET attempts = ?, next_retry_at = ? WHERE id = ?",
      [attempts + 1, next, id],
    );
  }

  markOutboxFailed(id: string): void {
    this.db.connection.exec("UPDATE message_outbox SET status = 'failed' WHERE id = ?", [id]);
  }

  enqueueSyncOutbox(targetDeviceId: string, envelopeJson: string): string {
    const id = generateId("syn");
    const now = isoNow();
    this.db.connection.exec(
      `INSERT INTO sync_outbox (id, target_device_id, envelope_json, attempts, next_retry_at, status, created_at)
       VALUES (?, ?, ?, 0, ?, 'pending', ?)`,
      [id, targetDeviceId, envelopeJson, now, now],
    );
    return id;
  }

  listPendingSyncOutbox(limit = 20): Array<{
    id: string;
    targetDeviceId: string;
    envelopeJson: string;
    attempts: number;
  }> {
    const now = isoNow();
    return this.db.connection
      .all<{
        id: string;
        target_device_id: string;
        envelope_json: string;
        attempts: number;
      }>(
        `SELECT id, target_device_id, envelope_json, attempts FROM sync_outbox
         WHERE status = 'pending' AND next_retry_at <= ? ORDER BY created_at LIMIT ?`,
        [now, limit],
      )
      .map((r) => ({
        id: r.id,
        targetDeviceId: r.target_device_id,
        envelopeJson: r.envelope_json,
        attempts: r.attempts,
      }));
  }

  markSyncOutboxSent(id: string): void {
    this.db.connection.exec("UPDATE sync_outbox SET status = 'sent' WHERE id = ?", [id]);
  }

  markSyncOutboxRetry(id: string, attempts: number): void {
    const delaySec = Math.min(60, 2 ** attempts);
    const next = new Date(Date.now() + delaySec * 1000).toISOString();
    this.db.connection.exec(
      "UPDATE sync_outbox SET attempts = ?, next_retry_at = ? WHERE id = ?",
      [attempts + 1, next, id],
    );
  }

  markSyncOutboxFailed(id: string): void {
    this.db.connection.exec("UPDATE sync_outbox SET status = 'failed' WHERE id = ?", [id]);
  }

  hasPendingOutbox(messageId: MessageId): boolean {
    const row = this.db.connection.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM message_outbox WHERE message_id = ? AND status = 'pending'",
      [messageId],
    );
    return (Number(row?.n) || 0) > 0;
  }

  countByChat(chatId: ChatId): number {
    const row = this.db.connection.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?",
      [chatId],
    );
    return Number(row?.n) || 0;
  }

  hasMessagesBefore(chatId: ChatId, createdAt: string): boolean {
    const row = this.db.connection.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND created_at < ?",
      [chatId, createdAt],
    );
    return (Number(row?.n) || 0) > 0;
  }

  listIncomingSince(chatId: ChatId, viewerUserId: UserId, sinceIso: string | null): StoredMessage[] {
    const rows = this.db.connection.all<{
      id: string;
      chat_id: string;
      sender_user_id: string;
      sender_device_id: string;
      content_type: string;
      content_text: string;
      status: string;
      client_nonce: string;
      created_at: string;
    }>(
      `SELECT * FROM messages
       WHERE chat_id = ? AND sender_user_id != ? AND created_at > ?
       ORDER BY created_at ASC`,
      [chatId, viewerUserId, sinceIso ?? ""],
    );
    return rows.map((row) => ({
      id: row.id as MessageId,
      chatId: row.chat_id as ChatId,
      senderUserId: row.sender_user_id as UserId,
      senderDeviceId: row.sender_device_id as DeviceId,
      contentType: row.content_type,
      contentText: row.content_text,
      status: row.status as MessageDeliveryStatus,
      clientNonce: row.client_nonce,
      createdAt: row.created_at,
    }));
  }
}
