import { sha256 } from "@noble/hashes/sha256";
import { bytesToBase64Url } from "@lockal/crypto";
import { randomBytes } from "@lockal/shared";
import type { LocalSession } from "@lockal/domain";
import type { DeviceId, OrganizationId, UserId } from "@lockal/shared";
import { isoNow } from "@lockal/shared";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export interface SessionIssueResult {
  token: string;
  tokenHash: string;
  session: LocalSession;
}

export function issueSession(
  userId: UserId,
  deviceId: DeviceId,
  organizationId: OrganizationId,
): SessionIssueResult {
  const token = bytesToBase64Url(randomBytes(32));
  const tokenHash = hashToken(token);
  const now = isoNow();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  return {
    token,
    tokenHash,
    session: {
      userId,
      deviceId,
      organizationId,
      tokenHash,
      expiresAt,
      createdAt: now,
    },
  };
}

export function hashToken(token: string): string {
  const hash = sha256(new TextEncoder().encode(token));
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function isSessionExpired(session: LocalSession): boolean {
  return new Date(session.expiresAt).getTime() <= Date.now();
}
