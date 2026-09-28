import type { User } from "@lockal/domain";
import { UserRole, UserStatus } from "@lockal/domain";
import type { OrganizationId, UserId } from "@lockal/shared";
import type { SqliteConnection } from "../connection.js";

type UserRow = {
  id: string;
  organization_id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: string;
  status: string;
  department_id: string | null;
  avatar_url: string | null;
  presence: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapUser(row: UserRow): User {
  return {
    id: row.id as UserId,
    organizationId: row.organization_id as OrganizationId,
    username: row.username,
    displayName: row.display_name,
    role: row.role as UserRole,
    status: row.status as UserStatus,
    departmentId: row.department_id,
    avatarUrl: row.avatar_url,
    presence: row.presence as User["presence"],
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class UserRepository {
  constructor(private readonly db: SqliteConnection) {}

  create(user: User & { passwordHash: string }): void {
    this.db.exec(
      `INSERT INTO users (
        id, organization_id, username, display_name, password_hash, role, status,
        department_id, avatar_url, presence, last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        user.organizationId,
        user.username,
        user.displayName,
        user.passwordHash,
        user.role,
        user.status,
        user.departmentId,
        user.avatarUrl,
        user.presence,
        user.lastSeenAt,
        user.createdAt,
        user.updatedAt,
      ],
    );
  }

  findByUsername(organizationId: OrganizationId, username: string): (User & { passwordHash: string }) | null {
    const row = this.db.get<UserRow>(
      "SELECT * FROM users WHERE organization_id = ? AND username = ?",
      [organizationId, username],
    );
    if (!row) return null;
    return { ...mapUser(row), passwordHash: row.password_hash };
  }

  findById(id: UserId): User | null {
    const row = this.db.get<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
    return row ? mapUser(row) : null;
  }

  listByOrganization(organizationId: OrganizationId): User[] {
    return this.db
      .all<UserRow>("SELECT * FROM users WHERE organization_id = ? ORDER BY display_name", [organizationId])
      .map(mapUser);
  }

  updateStatus(id: UserId, status: UserStatus, updatedAt: string): void {
    this.db.exec("UPDATE users SET status = ?, updated_at = ? WHERE id = ?", [status, updatedAt, id]);
  }
}
