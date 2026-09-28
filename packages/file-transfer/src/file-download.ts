import type { DatabaseContext } from "@lockal/database";
import type { MessageId } from "@lockal/shared";
import type { BlobStore } from "./blob-store.js";

export class FileDownloadService {
  constructor(
    private readonly db: DatabaseContext,
    private readonly blobStore: BlobStore,
  ) {}

  async getBlobForMessage(
    messageId: MessageId,
  ): Promise<{ fileName: string; mimeType: string; blob: Blob } | null> {
    const row = this.db.connection.get<{
      blob_key: string;
      transfer_id: string;
    }>(
      `SELECT a.blob_key, a.transfer_id FROM attachments a WHERE a.message_id = ?`,
      [messageId],
    );
    if (!row) return null;
    const transfer = this.db.connection.get<{ file_name: string; mime_type: string; status: string }>(
      "SELECT file_name, mime_type, status FROM file_transfers WHERE id = ?",
      [row.transfer_id],
    );
    const blob = await this.blobStore.get(row.blob_key);
    if (!blob) return null;
    return {
      fileName: transfer?.file_name ?? "download",
      mimeType: transfer?.mime_type ?? "application/octet-stream",
      blob,
    };
  }

  listTransferProgress(chatId: string): Array<{
    id: string;
    messageId: string | null;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    status: string;
    nextChunkIndex: number;
    totalChunks: number;
    senderDeviceId: string;
  }> {
    return this.db.connection
      .all<{
        id: string;
        message_id: string | null;
        file_name: string;
        mime_type: string;
        size_bytes: number;
        status: string;
        next_chunk_index: number;
        total_chunks: number;
        sender_device_id: string;
      }>(
        `SELECT id, message_id, file_name, mime_type, size_bytes, status, next_chunk_index, total_chunks, sender_device_id
         FROM file_transfers WHERE chat_id = ?`,
        [chatId],
      )
      .map((r) => ({
        id: r.id,
        messageId: r.message_id,
        fileName: r.file_name,
        mimeType: r.mime_type,
        sizeBytes: r.size_bytes,
        status: r.status,
        nextChunkIndex: r.next_chunk_index,
        totalChunks: r.total_chunks,
        senderDeviceId: r.sender_device_id,
      }));
  }
}
