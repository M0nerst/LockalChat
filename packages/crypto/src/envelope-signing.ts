import type { ProtocolEnvelope } from "@lockal/shared";
import { signPayload, verifyPayload } from "./signing.js";

/** Deterministic JSON so signatures survive Rust/JSON key reordering on relay.
 * Undefined fields are omitted, matching JSON.stringify on the wire. A key
 * that is present at sign time and dropped by the daemon used to fail
 * verification — direct-message file metadata (`group: undefined`) never
 * arrived, while group files (a real `group` object) did. */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => stableStringify(item === undefined ? null : item))
      .join(",")}]`;
  }
  if (kind === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
  }
  return "null";
}

export function envelopeSignBytes(envelope: Omit<ProtocolEnvelope, "signature">): Uint8Array {
  const canonical = {
    messageType: envelope.messageType,
    messageId: envelope.messageId,
    senderDeviceId: envelope.senderDeviceId,
    timestamp: envelope.timestamp,
    nonce: envelope.nonce,
    payload: envelope.payload,
  };
  return new TextEncoder().encode(stableStringify(canonical));
}

export async function signEnvelope(
  privateKeyBase64: string,
  envelope: Omit<ProtocolEnvelope, "signature">,
): Promise<string> {
  return signPayload(privateKeyBase64, envelopeSignBytes(envelope));
}

export async function verifyEnvelope(
  publicKeyBase64: string,
  envelope: ProtocolEnvelope,
): Promise<boolean> {
  if (!envelope.signature) return false;
  const { signature, ...unsigned } = envelope;
  void signature;
  return verifyPayload(publicKeyBase64, envelopeSignBytes(unsigned), envelope.signature);
}
