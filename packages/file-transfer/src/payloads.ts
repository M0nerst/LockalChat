export interface FileMetaPayload {
  transferId: string;
  chatId: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hex: string;
  chunkSize: number;
  totalChunks: number;
}

export interface FileChunkPayload {
  transferId: string;
  chunkIndex: number;
  dataBase64: string;
}

export interface FileCompletePayload {
  transferId: string;
  sha256Hex: string;
}

export interface FileResumePayload {
  transferId: string;
  nextChunkIndex: number;
}
