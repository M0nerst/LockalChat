import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

import { base64ToBytes } from "./encoding.js";

export function fingerprintFromPublicKey(publicKeyBase64: string): string {
  const hash = sha256(base64ToBytes(publicKeyBase64));
  const hex = bytesToHex(hash).toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 4) {
    groups.push(hex.slice(i, i + 4));
  }
  return groups.join("-");
}

export function fingerprintFromBytes(data: Uint8Array): string {
  const hash = sha256(data);
  const hex = bytesToHex(hash).toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 4) {
    groups.push(hex.slice(i, i + 4));
  }
  return groups.join("-");
}
