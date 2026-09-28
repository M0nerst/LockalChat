import type { DeviceId, OrganizationId, UserId } from "@lockal/shared";
import type { DeviceTrustStatus, PresenceStatus, UserRole, UserStatus } from "./enums.js";

export interface Organization {
  id: OrganizationId;
  name: string;
  publicKey: string;
  fingerprint: string;
  createdAt: string;
}

export interface User {
  id: UserId;
  organizationId: OrganizationId;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  departmentId: string | null;
  avatarUrl: string | null;
  presence: PresenceStatus;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: DeviceId;
  userId: UserId;
  organizationId: OrganizationId;
  name: string;
  platform: string;
  appVersion: string;
  publicKey: string;
  fingerprint: string;
  trustStatus: DeviceTrustStatus;
  lastSeenAt: string | null;
  lastIp: string | null;
  createdAt: string;
}

export interface LocalSession {
  userId: UserId;
  deviceId: DeviceId;
  organizationId: OrganizationId;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface Department {
  id: string;
  organizationId: OrganizationId;
  name: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  organizationId: OrganizationId;
  actorUserId: UserId | null;
  actorDeviceId: DeviceId | null;
  eventType: string;
  detailsJson: string;
  createdAt: string;
}
