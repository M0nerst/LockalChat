import { parsePasswordHash, verifyPassword } from "@lockal/crypto";
import type { DatabaseContext } from "@lockal/database";
import { AuditEventType, PresenceStatus, UserStatus } from "@lockal/domain";
import type { Device, Organization, User } from "@lockal/domain";
import { AuthError } from "@lockal/shared";
import type { DeviceId, OrganizationId } from "@lockal/shared";
import { isoNow } from "@lockal/shared";
import { hashToken, isSessionExpired, issueSession } from "./session-store.js";

export interface LoginInput {
  organizationId: OrganizationId;
  username: string;
  password: string;
  deviceId: DeviceId;
}

export interface AuthContext {
  user: User;
  device: Device;
  organization: Organization;
  sessionToken: string;
}

export class AuthService {
  constructor(private readonly db: DatabaseContext) {}

  getLocalOrganization(): Organization | null {
    return this.db.organizations.getFirst();
  }

  login(input: LoginInput): AuthContext {
    const org = this.db.organizations.getById(input.organizationId);
    if (!org) {
      throw new AuthError("ORG_NOT_FOUND", "Организация не найдена на этом устройстве");
    }

    const record = this.db.users.findByUsername(input.organizationId, input.username);
    if (!record) {
      throw new AuthError("INVALID_CREDENTIALS", "Неверное имя пользователя или пароль");
    }

    if (record.status === UserStatus.Blocked) {
      throw new AuthError("USER_BLOCKED", "Учётная запись заблокирована администратором");
    }

    const hash = parsePasswordHash(record.passwordHash);
    if (!verifyPassword(input.password, hash)) {
      throw new AuthError("INVALID_CREDENTIALS", "Неверное имя пользователя или пароль");
    }

    const device = this.db.devices.findById(input.deviceId);
    if (!device || device.userId !== record.id) {
      throw new AuthError("DEVICE_NOT_FOUND", "Устройство не зарегистрировано для этого пользователя");
    }

    if (device.trustStatus === "revoked") {
      throw new AuthError("DEVICE_REVOKED", "Доступ с этого устройства отозван");
    }

    const now = isoNow();

    const { token, session } = issueSession(record.id, device.id, org.id);
    this.db.sessions.create(session);

    this.db.audit.append({
      organizationId: org.id,
      actorUserId: record.id,
      actorDeviceId: device.id,
      eventType: AuditEventType.Login,
      detailsJson: JSON.stringify({ username: record.username }),
      createdAt: now,
    });

    const authenticatedUser = this.db.users.findById(record.id)!;
    return {
      user: { ...authenticatedUser, presence: PresenceStatus.Online, lastSeenAt: now },
      device,
      organization: org,
      sessionToken: token,
    };
  }

  validateSession(token: string): AuthContext | null {
    const tokenHash = hashToken(token);
    const session = this.db.sessions.findByTokenHash(tokenHash);
    if (!session || isSessionExpired(session)) {
      return null;
    }

    const user = this.db.users.findById(session.userId);
    const device = this.db.devices.findById(session.deviceId);
    const organization = this.db.organizations.getById(session.organizationId);
    if (!user || !device || !organization) return null;
    if (user.status === UserStatus.Blocked) return null;
    if (device.trustStatus === "revoked") return null;

    return {
      user,
      device,
      organization,
      sessionToken: token,
    };
  }
}
