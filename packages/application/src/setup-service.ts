import {
  generateIdentityKeyPair,
  MemorySecureStorage,
  type SecureStorage,
  serializePasswordHash,
  hashPassword,
} from "@lockal/crypto";
import type { DatabaseContext } from "@lockal/database";
import { AuditEventType, DeviceTrustStatus, PresenceStatus, UserRole, UserStatus } from "@lockal/domain";
import { deviceId, isoNow, organizationId, userId } from "@lockal/shared";
import type { DeviceId, OrganizationId, UserId } from "@lockal/shared";
import { issueSession } from "./session-store.js";

export interface CreateOrganizationInput {
  organizationName: string;
  adminUsername: string;
  adminDisplayName: string;
  adminPassword: string;
  deviceName: string;
  platform: string;
  appVersion: string;
}

export interface SetupResult {
  organizationId: OrganizationId;
  userId: UserId;
  deviceId: DeviceId;
  organizationFingerprint: string;
  deviceFingerprint: string;
  sessionToken: string;
}

export class SetupService {
  constructor(
    private readonly db: DatabaseContext,
    private readonly secureStorage: SecureStorage = new MemorySecureStorage(),
  ) {}

  async createOrganization(input: CreateOrganizationInput): Promise<SetupResult> {
    if (this.db.organizations.getFirst()) {
      throw new Error("Организация уже создана на этом устройстве");
    }

    const orgKeys = await generateIdentityKeyPair();
    const deviceKeys = await generateIdentityKeyPair();
    const orgId = organizationId();
    const adminId = userId();
    const devId = deviceId();
    const now = isoNow();

    const passwordHash = serializePasswordHash(hashPassword(input.adminPassword));

    this.db.organizations.create(
      {
        id: orgId,
        name: input.organizationName,
        publicKey: orgKeys.publicKey,
        fingerprint: orgKeys.fingerprint,
        createdAt: now,
      },
      orgKeys.privateKey,
    );

    this.db.users.create({
      id: adminId,
      organizationId: orgId,
      username: input.adminUsername,
      displayName: input.adminDisplayName,
      passwordHash,
      role: UserRole.Admin,
      status: UserStatus.Active,
      departmentId: null,
      avatarUrl: null,
      presence: PresenceStatus.Online,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });

    this.db.devices.create({
      id: devId,
      userId: adminId,
      organizationId: orgId,
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
    await this.secureStorage.set(`org:${orgId}:privateKey`, orgKeys.privateKey);

    const { token, session } = issueSession(adminId, devId, orgId);
    this.db.sessions.create(session);

    this.db.audit.append({
      organizationId: orgId,
      actorUserId: adminId,
      actorDeviceId: devId,
      eventType: AuditEventType.OrganizationCreated,
      detailsJson: JSON.stringify({ name: input.organizationName }),
      createdAt: now,
    });

    return {
      organizationId: orgId,
      userId: adminId,
      deviceId: devId,
      organizationFingerprint: orgKeys.fingerprint,
      deviceFingerprint: deviceKeys.fingerprint,
      sessionToken: token,
    };
  }
}
