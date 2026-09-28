import { scrypt } from "@noble/hashes/scrypt";
import { randomBytes } from "@lockal/shared";
import { bytesToBase64, base64ToBytes } from "./encoding.js";
import { timingSafeEqual } from "./util.js";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export interface PasswordHashRecord {
  algorithm: "scrypt-v1" | "argon2id-v1";
  salt: string;
  hash: string;
}

function derive(password: string, salt: Uint8Array): Uint8Array {
  const passwordBytes = new TextEncoder().encode(password);
  return scrypt(passwordBytes, salt, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, dkLen: KEY_LEN });
}

export function hashPassword(password: string): PasswordHashRecord {
  const salt = randomBytes(16);
  const derived = derive(password, salt);
  return {
    algorithm: "scrypt-v1",
    salt: bytesToBase64(salt),
    hash: bytesToBase64(derived),
  };
}

export function verifyPassword(password: string, record: PasswordHashRecord): boolean {
  const salt = base64ToBytes(record.salt);
  const expected = base64ToBytes(record.hash);
  const derived = derive(password, salt);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function serializePasswordHash(record: PasswordHashRecord): string {
  return JSON.stringify(record);
}

export function parsePasswordHash(serialized: string): PasswordHashRecord {
  return JSON.parse(serialized) as PasswordHashRecord;
}
