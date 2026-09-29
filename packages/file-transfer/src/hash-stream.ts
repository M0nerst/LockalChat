import { bytesToBase64 } from "@lockal/crypto";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

export const DEFAULT_CHUNK_SIZE = 64 * 1024;

export async function sha256HexOfBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return bytesToHex(sha256(new Uint8Array(buffer)));
}

export async function sha256HexOfFile(file: Blob, chunkSize = DEFAULT_CHUNK_SIZE): Promise<string> {
  const hasher = sha256.create();
  let offset = 0;
  while (offset < file.size) {
    const slice = file.slice(offset, offset + chunkSize);
    const buf = new Uint8Array(await slice.arrayBuffer());
    hasher.update(buf);
    offset += chunkSize;
  }
  return bytesToHex(hasher.digest());
}

export async function readFileChunkBase64(file: Blob, chunkIndex: number, chunkSize: number): Promise<string> {
  const start = chunkIndex * chunkSize;
  const slice = file.slice(start, start + chunkSize);
  const bytes = new Uint8Array(await slice.arrayBuffer());
  return bytesToBase64(bytes);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
