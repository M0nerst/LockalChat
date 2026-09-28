import * as ed from "@noble/ed25519";
import { base64ToBytes, bytesToBase64 } from "./encoding.js";

export async function signPayload(
  privateKeyBase64: string,
  payload: Uint8Array,
): Promise<string> {
  if (!privateKeyBase64) {
    throw new Error(
      "Ключ устройства не найден. Выйдите из аккаунта и войдите снова; если не поможет — создайте организацию заново.",
    );
  }
  const privateKey = base64ToBytes(privateKeyBase64);
  if (privateKey.length !== 32) {
    throw new Error("Неверный ключ устройства. Выйдите и войдите снова.");
  }
  const signature = await ed.signAsync(payload, privateKey);
  return bytesToBase64(signature);
}

export async function verifyPayload(
  publicKeyBase64: string,
  payload: Uint8Array,
  signatureBase64: string,
): Promise<boolean> {
  try {
    const publicKey = base64ToBytes(publicKeyBase64);
    const signature = base64ToBytes(signatureBase64);
    return await ed.verifyAsync(signature, payload, publicKey);
  } catch {
    return false;
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}
