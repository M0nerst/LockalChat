import { generateIdentityKeyPair, type SecureStorage } from "@lockal/crypto";
import type { DatabaseContext } from "@lockal/database";
import { AuditEventType, DeviceTrustStatus, PresenceStatus, UserRole, UserStatus } from "@lockal/domain";
import { deviceId, isoNow } from "@lockal/shared";
import type { DeviceId, OrganizationId, UserId } from "@lockal/shared";
import type { OrganizationInviteV1 } from "./invite-service.js";
import { AuthService, type AuthContext } from "./auth-service.js";

export interface JoinOrganizationInput {
  invite: OrganizationInviteV1;
  username: string;
  password: string;
  deviceName: string;
  platform: string;
  appVersion: string;
}

export interface JoinResult {
  deviceId: DeviceId;
  organizationFingerprint: string;
  auth: AuthContext;
}

export class JoinService {
  constructor(
    private readonly db: DatabaseContext,
    private readonly secureStorage: SecureStorage,
  ) {}

  async join(input: JoinOrganizationInput): Promise<JoinResult> {
    if (this.db.organizations.getFirst()) {
      throw new Error("Это устройство уже подключено к организации. Войдите или сбросьте локальные данные.");
    }
    if (input.invite.version !== 1) {
      throw new Error("Неподдерживаемая версия приглашения");
    }

    const org = input.invite.organization;
    const now = isoNow();
    this.db.organizations.create(
      {
        id: org.id as OrganizationId,
        name: org.name,
        publicKey: org.publicKey,
        fingerprint: org.fingerprint,
        createdAt: now,
      },
      null,
    );

    const roster =
      input.invite.users ??
      (input.invite.user
        ? [
            {
              id: input.invite.user.id,
              username: input.invite.user.username,
              displayName: input.invite.user.displayName,
              role: input.invite.user.role,
              passwordHash: input.invite.user.passwordHash,
            },
          ]
        : []);

    for (const d of input.invite.devices ?? []) {
      if (this.db.devices.findById(d.id as DeviceId)) continue;
      this.db.devices.create({
        id: d.id as DeviceId,
        userId: d.userId as UserId,
        organizationId: org.id as OrganizationId,
        name: d.name,
        platform: d.platform,
        appVersion: d.appVersion,
        publicKey: d.publicKey,
        fingerprint: d.fingerprint,
        trustStatus: d.trustStatus as DeviceTrustStatus,
        lastSeenAt: null,
        lastIp: null,
        createdAt: d.createdAt,
      });
    }

    for (const u of roster) {
      const existing = this.db.users.findByUsername(org.id as OrganizationId, u.username);
      if (!existing) {
        this.db.users.create({
          id: u.id as UserId,
          organizationId: org.id as OrganizationId,
          username: u.username,
          displayName: u.displayName,
          passwordHash: u.passwordHash,
          role: u.role as UserRole,
          status: UserStatus.Active,
          departmentId: null,
          avatarUrl: null,
          presence: PresenceStatus.Offline,
          lastSeenAt: null,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const auth = new AuthService(this.db);
    const record = this.db.users.findByUsername(org.id as OrganizationId, input.username);
    if (!record) {
      throw new Error("Пользователь не найден в приглашении. Проверьте логин или файл invite.");
    }

    const deviceKeys = await generateIdentityKeyPair();
    const devId = deviceId();
    this.db.devices.create({
      id: devId,
      userId: record.id,
      organizationId: org.id as OrganizationId,
      name: input.deviceName,
      platform: input.platform,
      appVersion: input.appVersion,
      publicKey: deviceKeys.publicKey,
      fingerprint: deviceKeys.fingerprint,
      trustStatus: DeviceTrustStatus.Trusted,
      lastSeenAt: now,
      lastIp: null,
      createdAt: now,
    });
    await this.secureStorage.set(`device:${devId}:privateKey`, deviceKeys.privateKey);

    const authContext = auth.login({
      organizationId: org.id as OrganizationId,
      username: input.username,
      password: input.password,
      deviceId: devId,
    });

    this.db.audit.append({
      organizationId: org.id as OrganizationId,
      actorUserId: record.id,
      actorDeviceId: devId,
      eventType: AuditEventType.DeviceAdded,
      detailsJson: JSON.stringify({ deviceName: input.deviceName, via: "invite" }),
      createdAt: now,
    });

    return {
      deviceId: devId,
      organizationFingerprint: org.fingerprint,
      auth: authContext,
    };
  }
}
