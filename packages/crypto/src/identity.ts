import * as ed from "@noble/ed25519";
import { randomBytes } from "@lockal/shared";
import { fingerprintFromPublicKey } from "./fingerprint.js";
import { bytesToBase64, bytesToBase64Url } from "./encoding.js";

export interface IdentityKeyPair {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

export async function generateIdentityKeyPair(): Promise<IdentityKeyPair> {
  const privateKeyBytes = ed.utils.randomPrivateKey();
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKeyBytes);
  const publicKey = bytesToBase64(publicKeyBytes);
  const privateKey = bytesToBase64(privateKeyBytes);
  return {
    publicKey,
    privateKey,
    fingerprint: fingerprintFromPublicKey(publicKey),
  };
}

export function randomNonce(): string {
  return bytesToBase64Url(randomBytes(24));
}
