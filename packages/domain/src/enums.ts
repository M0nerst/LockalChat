export enum UserRole {
  Admin = "ADMIN",
  User = "USER",
}

export enum UserStatus {
  Active = "active",
  Blocked = "blocked",
}

export enum DeviceTrustStatus {
  Pending = "pending",
  Trusted = "trusted",
  Revoked = "revoked",
}

export enum PresenceStatus {
  Online = "online",
  Away = "away",
  DoNotDisturb = "dnd",
  Offline = "offline",
}

export enum MessageDeliveryStatus {
  Sending = "sending",
  Sent = "sent",
  Delivered = "delivered",
  Read = "read",
  Failed = "failed",
}

export enum AuditEventType {
  Login = "login",
  Logout = "logout",
  UserCreated = "user_created",
  UserDeleted = "user_deleted",
  UserBlocked = "user_blocked",
  UserUnblocked = "user_unblocked",
  PermissionChanged = "permission_changed",
  DeviceAdded = "device_added",
  DeviceRevoked = "device_revoked",
  OrganizationCreated = "organization_created",
}
