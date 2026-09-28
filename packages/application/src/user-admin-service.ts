import { hashPassword, parsePasswordHash, serializePasswordHash, verifyPassword } from "@lockal/crypto";
import type { DatabaseContext } from "@lockal/database";
import { AuditEventType, UserRole, UserStatus } from "@lockal/domain";
import type { User } from "@lockal/domain";
import { PermissionAction, assertPermission, roleGrants } from "@lockal/permissions";
import { PermissionError } from "@lockal/shared";
import type { OrganizationId, UserId } from "@lockal/shared";
import { isoNow, userId } from "@lockal/shared";

export interface CreateUserInput {
  username: string;
  displayName: string;
  password: string;
  role: UserRole;
}

export class UserAdminService {
  constructor(private readonly db: DatabaseContext) {}

  createUser(actor: User, input: CreateUserInput): User {
    if (!roleGrants(actor.role, PermissionAction.UserCreate)) {
      throw new PermissionError(PermissionAction.UserCreate);
    }

    const existing = this.db.users.findByUsername(actor.organizationId, input.username);
    if (existing) {
      throw new Error("Такой логин уже занят");
    }

    const now = isoNow();
    const id = userId();
    const passwordHash = serializePasswordHash(hashPassword(input.password));

    const user: User & { passwordHash: string } = {
      id,
      organizationId: actor.organizationId,
      username: input.username,
      displayName: input.displayName,
      passwordHash,
      role: input.role,
      status: UserStatus.Active,
      departmentId: null,
      avatarUrl: null,
      presence: "offline" as User["presence"],
      lastSeenAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.db.users.create(user);

    this.db.audit.append({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      actorDeviceId: null,
      eventType: AuditEventType.UserCreated,
      detailsJson: JSON.stringify({ userId: id, username: input.username, role: input.role }),
      createdAt: now,
    });

    const { passwordHash: _, ...created } = user;
    void _;
    return created;
  }

  blockUser(actor: User, targetId: UserId): void {
    assertPermission(actor.role, PermissionAction.UserBlock);
    if (actor.id === targetId) {
      throw new Error("Cannot block yourself");
    }
    const now = isoNow();
    this.db.users.updateStatus(targetId, UserStatus.Blocked, now);
    this.db.sessions.deleteByUser(targetId);
    this.db.audit.append({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      actorDeviceId: null,
      eventType: AuditEventType.UserBlocked,
      detailsJson: JSON.stringify({ userId: targetId }),
      createdAt: now,
    });
  }

  unblockUser(actor: User, targetId: UserId): void {
    assertPermission(actor.role, PermissionAction.UserUnblock);
    const now = isoNow();
    this.db.users.updateStatus(targetId, UserStatus.Active, now);
    this.db.audit.append({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      actorDeviceId: null,
      eventType: AuditEventType.UserUnblocked,
      detailsJson: JSON.stringify({ userId: targetId }),
      createdAt: now,
    });
  }

  listUsers(actor: User, organizationId: OrganizationId): User[] {
    if (!roleGrants(actor.role, PermissionAction.UserList)) {
      throw new PermissionError(PermissionAction.UserList);
    }
    if (actor.organizationId !== organizationId) {
      throw new PermissionError(PermissionAction.UserList);
    }
    return this.db.users.listByOrganization(organizationId);
  }

  /** The signed-in user edits their own display name, avatar color and password.
   * Password change requires the current password. Directory sync picks the row
   * up because `updated_at` moves forward. */
  updateOwnProfile(
    actor: User,
    input: {
      displayName: string;
      avatarUrl: string | null;
      currentPassword?: string;
      newPassword?: string;
    },
  ): User {
    const displayName = input.displayName.trim();
    if (!displayName) throw new Error("Укажите имя");
    const now = isoNow();
    let passwordHash: string | undefined;
    const nextPassword = input.newPassword?.trim() ?? "";
    if (nextPassword.length > 0) {
      if (nextPassword.length < 4) throw new Error("Новый пароль должен быть не короче 4 символов");
      if (!input.currentPassword) throw new Error("Введите текущий пароль");
      const record = this.db.users.findByUsername(actor.organizationId, actor.username);
      if (!record) throw new Error("Пользователь не найден");
      if (!verifyPassword(input.currentPassword, parsePasswordHash(record.passwordHash))) {
        throw new Error("Текущий пароль неверный");
      }
      passwordHash = serializePasswordHash(hashPassword(nextPassword));
    }
    this.db.users.updateProfile(actor.id, {
      displayName,
      avatarUrl: input.avatarUrl,
      passwordHash,
      updatedAt: now,
    });
    const updated = this.db.users.findById(actor.id);
    if (!updated) throw new Error("Пользователь не найден");
    return updated;
  }
}
