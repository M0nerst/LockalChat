import { UserRole } from "@lockal/domain";
import { PermissionError } from "@lockal/shared";
import { PermissionAction } from "./actions.js";

const ADMIN_ACTIONS: ReadonlySet<PermissionAction> = new Set([
  PermissionAction.UserCreate,
  PermissionAction.UserDelete,
  PermissionAction.UserBlock,
  PermissionAction.UserUnblock,
  PermissionAction.UserUpdateProfile,
  PermissionAction.UserChangeRole,
  PermissionAction.UserList,
  PermissionAction.DeviceList,
  PermissionAction.DeviceRevoke,
  PermissionAction.DeviceTrust,
  PermissionAction.GroupCreate,
  PermissionAction.GroupDelete,
  PermissionAction.GroupManageMembers,
  PermissionAction.PolicyUpdate,
  PermissionAction.AuditLogView,
  PermissionAction.ChatSend,
  PermissionAction.ChatCreateGroup,
  PermissionAction.FileSend,
  PermissionAction.CallInitiate,
  PermissionAction.ProfileUpdateSelf,
]);

const USER_ACTIONS: ReadonlySet<PermissionAction> = new Set([
  PermissionAction.UserList,
  PermissionAction.ChatSend,
  PermissionAction.FileSend,
  PermissionAction.CallInitiate,
  PermissionAction.ProfileUpdateSelf,
]);

export function roleGrants(role: UserRole, action: PermissionAction): boolean {
  if (role === UserRole.Admin) {
    return ADMIN_ACTIONS.has(action);
  }
  return USER_ACTIONS.has(action);
}

export function assertPermission(role: UserRole, action: PermissionAction): void {
  if (!roleGrants(role, action)) {
    throw new PermissionError(action);
  }
}
