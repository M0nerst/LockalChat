export const PROTOCOL_VERSION = 1 as const;

export type MessageType =
  | "chat.message"
  | "chat.ack"
  | "chat.reaction"
  | "presence.update"
  | "device.hello"
  | "device.trust"
  | "admin.signed"
  | "file.meta"
  | "file.chunk"
  | "file.complete"
  | "file.resume"
  | "call.signal"
  | "sync.envelope";

export interface ProtocolEnvelope<TPayload = unknown> {
  protocolVersion: typeof PROTOCOL_VERSION;
  messageType: MessageType;
  messageId: string;
  senderDeviceId: string;
  timestamp: string;
  nonce: string;
  payload: TPayload;
  signature?: string;
}

export function createEnvelope<T>(
  partial: Omit<ProtocolEnvelope<T>, "protocolVersion" | "timestamp"> & {
    timestamp?: string;
  },
): ProtocolEnvelope<T> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    timestamp: partial.timestamp ?? new Date().toISOString(),
    messageType: partial.messageType,
    messageId: partial.messageId,
    senderDeviceId: partial.senderDeviceId,
    nonce: partial.nonce,
    payload: partial.payload,
    signature: partial.signature,
  };
}
