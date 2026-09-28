import type { LocalSession } from "@lockal/domain";
import type { DeviceId, OrganizationId, UserId } from "@lockal/shared";
import { generateId } from "@lockal/shared";
import type { SqliteConnection } from "../connection.js";

export class SessionRepository {
  constructor(private readonly db: SqliteConnection) {}

  create(session: LocalSession): string {
    const id = generateId("ses");
    this.db.exec(
      `INSERT INTO sessions (id, user_id, device_id, organization_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        session.userId,
        session.deviceId,
        session.organizationId,
        session.tokenHash,
        session.expiresAt,
        session.createdAt,
      ],
    );
    return id;
  }

  findByTokenHash(tokenHash: string): LocalSession | null {
    const row = this.db.get<{
      user_id: string;
      device_id: string;
      organization_id: string;
      token_hash: string;
      expires_at: string;
      created_at: string;
    }>("SELECT user_id, device_id, organization_id, token_hash, expires_at, created_at FROM sessions WHERE token_hash = ?", [
      tokenHash,
    ]);
    if (!row) return null;
    return {
      userId: row.user_id as UserId,
      deviceId: row.device_id as DeviceId,
      organizationId: row.organization_id as OrganizationId,
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  deleteByUser(userId: UserId): void {
    this.db.exec("DELETE FROM sessions WHERE user_id = ?", [userId]);
  }
}
