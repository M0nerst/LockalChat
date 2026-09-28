import type { DatabaseContext } from "@lockal/database";
import type { ChatId, DeviceId, MessageId, UserId } from "@lockal/shared";
import { generateId, isoNow } from "@lockal/shared";

export type TransferStatus =
  | "pending"
  | "sending"
  | "receiving"
  | "completed"
  | "failed"
  | "paused"
  | "cancelled";

export interface FileTransferRecord {
  id: string;
  chatId: ChatId;
  messageId: MessageId | null;
  senderUserId: UserId;
  senderDeviceId: DeviceId;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hex: string;
  chunkSize: number;
  totalChunks: number;
  nextChunkIndex: number;
  status: TransferStatus;
  createdAt: string;
}

export class TransferRepository {
  constructor(private readonly db: DatabaseContext) {}

  create(record: Omit<FileTransferRecord, "createdAt" | "nextChunkIndex" | "status"> & {
    status?: TransferStatus;
    nextChunkIndex?: number;
  }): void {
    const now = isoNow();
    this.db.connection.exec(
      `INSERT INTO file_transfers (
        id, chat_id, message_id, sender_user_id, sender_device_id, file_name, mime_type,
        size_bytes, sha256_hex, chunk_size, total_chunks, next_chunk_index, status, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        record.id,
        record.chatId,
        record.messageId,
        record.senderUserId,
        record.senderDeviceId,
        record.fileName,
        record.mimeType,
        record.sizeBytes,
        record.sha256Hex,
        record.chunkSize,
        record.totalChunks,
        record.nextChunkIndex ?? 0,
        record.status ?? "pending",
        now,
      ],
    );
  }

  get(id: string): FileTransferRecord | null {
    const row = this.db.connection.get<{
      id: string;
      chat_id: string;
      message_id: string | null;
      sender_user_id: string;
      sender_device_id: string;
      file_name: string;
      mime_type: string;
      size_bytes: number;
      sha256_hex: string;
      chunk_size: number;
      total_chunks: number;
      next_chunk_index: number;
      status: string;
      created_at: string;
    }>("SELECT * FROM file_transfers WHERE id = ?", [id]);
    if (!row) return null;
    return {
      id: row.id,
      chatId: row.chat_id as ChatId,
      messageId: row.message_id as MessageId | null,
      senderUserId: row.sender_user_id as UserId,
      senderDeviceId: row.sender_device_id as DeviceId,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      sha256Hex: row.sha256_hex,
      chunkSize: row.chunk_size,
      totalChunks: row.total_chunks,
      nextChunkIndex: row.next_chunk_index,
      status: row.status as TransferStatus,
      createdAt: row.created_at,
    };
  }

  updateProgress(id: string, nextChunkIndex: number, status: TransferStatus): void {
    this.db.connection.exec(
      "UPDATE file_transfers SET next_chunk_index = ?, status = ? WHERE id = ?",
      [nextChunkIndex, status, id],
    );
  }

  markCompleted(id: string): void {
    this.db.connection.exec(
      `UPDATE file_transfers SET status = 'completed', completed_at = ?,
       next_chunk_index = total_chunks WHERE id = ?`,
      [isoNow(), id],
    );
  }

  /** Sets status directly, guarded to only apply from an active/inactive pair of states
   * the caller has already validated (pause/resume/cancel). */
  setStatus(id: string, status: TransferStatus): void {
    this.db.connection.exec("UPDATE file_transfers SET status = ? WHERE id = ?", [status, id]);
  }

  hasPendingOutbox(transferId: string): boolean {
    const row = this.db.connection.get<{ n: number }>(
      "SELECT COUNT(*) as n FROM file_chunk_outbox WHERE transfer_id = ? AND status = 'pending'",
      [transferId],
    );
    return (row?.n ?? 0) > 0;
  }

  /** Removes not-yet-sent chunk jobs for a transfer — used when cancelling so a
   * paused/cancelled upload doesn't keep re-queuing chunks once resumed by mistake. */
  deletePendingOutbox(transferId: string): void {
    this.db.connection.exec(
      "DELETE FROM file_chunk_outbox WHERE transfer_id = ? AND status = 'pending'",
      [transferId],
    );
  }

  /** Clears exponential-backoff delay on a transfer's queued chunks so a user-triggered
   * "Resume" retries immediately instead of waiting out whatever backoff was in effect
   * when the transfer stalled/was paused. */
  resetPendingRetry(transferId: string): void {
    this.db.connection.exec(
      "UPDATE file_chunk_outbox SET next_retry_at = ? WHERE transfer_id = ? AND status = 'pending'",
      [isoNow(), transferId],
    );
  }

  linkAttachment(messageId: MessageId, transferId: string, blobKey: string): void {
    const id = generateId("att");
    this.db.connection.exec(
      "INSERT INTO attachments (id, message_id, transfer_id, blob_key, created_at) VALUES (?, ?, ?, ?, ?)",
      [id, messageId, transferId, blobKey, isoNow()],
    );
  }

  enqueueChunkOutbox(
    transferId: string,
    chunkIndex: number,
    targetDeviceId: DeviceId,
    envelopeJson: string,
  ): void {
    const id = generateId("fob");
    const now = isoNow();
    this.db.connection.exec(
      `INSERT OR REPLACE INTO file_chunk_outbox
       (id, transfer_id, chunk_index, target_device_id, envelope_json, attempts, next_retry_at, status)
       VALUES (?, ?, ?, ?, ?, 0, ?, 'pending')`,
      [id, transferId, chunkIndex, targetDeviceId, envelopeJson, now],
    );
  }

  listPendingChunks(limit = 50): Array<{
    id: string;
    transferId: string;
    chunkIndex: number;
    targetDeviceId: DeviceId;
    envelopeJson: string;
    attempts: number;
  }> {
    const now = isoNow();
    return this.db.connection
      .all<{
        id: string;
        transfer_id: string;
        chunk_index: number;
        target_device_id: string;
        envelope_json: string;
        attempts: number;
      }>(
        `SELECT o.id, o.transfer_id, o.chunk_index, o.target_device_id, o.envelope_json, o.attempts
         FROM file_chunk_outbox o
         JOIN file_transfers t ON t.id = o.transfer_id
         WHERE o.status = 'pending' AND o.next_retry_at <= ? AND t.status = 'sending'
         LIMIT ?`,
        [now, limit],
      )
      .map((r) => ({
        id: r.id,
        transferId: r.transfer_id,
        chunkIndex: r.chunk_index,
        targetDeviceId: r.target_device_id as DeviceId,
        envelopeJson: r.envelope_json,
        attempts: r.attempts,
      }));
  }

  markChunkSent(id: string): void {
    this.db.connection.exec("UPDATE file_chunk_outbox SET status = 'sent' WHERE id = ?", [id]);
  }

  markChunkRetry(id: string, attempts: number): void {
    const next = new Date(Date.now() + Math.min(60, 2 ** attempts) * 1000).toISOString();
    this.db.connection.exec(
      "UPDATE file_chunk_outbox SET attempts = ?, next_retry_at = ? WHERE id = ?",
      [attempts + 1, next, id],
    );
  }
}
