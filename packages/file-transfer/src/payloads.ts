import type { ProtocolEnvelope } from "@lockal/shared";

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
  /** Lets a peer create the group chat even if the roster envelope was missed. */
  group?: {
    title: string;
    memberUserIds: string[];
    rosterRevision?: number;
  };
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

/** One hop through another online computer when the recipient is not reachable directly. */
export interface FileRelayPayload {
  targetDeviceIds: string[];
  envelope: ProtocolEnvelope;
}
