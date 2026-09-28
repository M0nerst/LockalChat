export const PermissionAction = {
  // Users
  UserCreate: "user:create",
  UserDelete: "user:delete",
  UserBlock: "user:block",
  UserUnblock: "user:unblock",
  UserUpdateProfile: "user:update_profile",
  UserChangeRole: "user:change_role",
  UserList: "user:list",

  // Devices
  DeviceList: "device:list",
  DeviceRevoke: "device:revoke",
  DeviceTrust: "device:trust",

  // Groups
  GroupCreate: "group:create",
  GroupDelete: "group:delete",
  GroupManageMembers: "group:manage_members",

  // Org policy
  PolicyUpdate: "policy:update",
  AuditLogView: "audit:view",

  // User self
  ChatSend: "chat:send",
  ChatCreateGroup: "chat:create_group",
  FileSend: "file:send",
  CallInitiate: "call:initiate",
  ProfileUpdateSelf: "profile:update_self",
} as const;

// eslint-disable-next-line @typescript-eslint/no-redeclare -- intentional const-object + type-of-itself pattern
export type PermissionAction = (typeof PermissionAction)[keyof typeof PermissionAction];
