import type { DatabaseContext } from "@lockal/database";
import type { User } from "@lockal/domain";
import { PermissionAction, roleGrants } from "@lockal/permissions";
import { PermissionError } from "@lockal/shared";
import type { UserId } from "@lockal/shared";

export interface OrganizationInviteV1 {
  version: 1;
  organization: {
    id: string;
    name: string;
    publicKey: string;
    fingerprint: string;
  };
  user?: {
    id: string;
    username: string;
    displayName: string;
    role: string;
    passwordHash: string;
  };
  /** Full org roster (for join on a new device). */
  users?: Array<{
    id: string;
    username: string;
    displayName: string;
    role: string;
    passwordHash: string;
  }>;
  /** Known devices at export time (needed to verify incoming messages). */
  devices?: Array<{
    id: string;
    userId: string;
    name: string;
    platform: string;
    appVersion: string;
    publicKey: string;
    fingerprint: string;
    trustStatus: string;
    createdAt: string;
  }>;
}

export class InviteService {
  constructor(private readonly db: DatabaseContext) {}

  exportUserInvite(actor: User, targetUserId: UserId): OrganizationInviteV1 {
    if (!roleGrants(actor.role, PermissionAction.UserCreate)) {
      throw new PermissionError(PermissionAction.UserCreate);
    }
    const org = this.db.organizations.getById(actor.organizationId);
    if (!org) throw new Error("Organization missing");
    const record = this.db.users.findById(targetUserId);
    if (!record) throw new Error("User not found");
    const full = this.db.users.findByUsername(org.id, record.username);
    if (!full) throw new Error("User not found");
    const roster = this.db.users.listByOrganization(org.id).map((u) => {
      const row = this.db.users.findByUsername(org.id, u.username)!;
      return {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        passwordHash: row.passwordHash,
      };
    });

    const devices = this.db.devices.listByOrganization(org.id).map((d) => ({
      id: d.id,
      userId: d.userId,
      name: d.name,
      platform: d.platform,
      appVersion: d.appVersion,
      publicKey: d.publicKey,
      fingerprint: d.fingerprint,
      trustStatus: d.trustStatus,
      createdAt: d.createdAt,
    }));

    return {
      version: 1,
      organization: {
        id: org.id,
        name: org.name,
        publicKey: org.publicKey,
        fingerprint: org.fingerprint,
      },
      user: {
        id: record.id,
        username: record.username,
        displayName: record.displayName,
        role: record.role,
        passwordHash: full.passwordHash,
      },
      users: roster,
      devices,
    };
  }
}
