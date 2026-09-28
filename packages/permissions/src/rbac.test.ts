import { describe, expect, it } from "vitest";
import { UserRole } from "@lockal/domain";
import { PermissionError } from "@lockal/shared";
import { PermissionAction } from "./actions.js";
import { assertPermission, roleGrants } from "./rbac.js";

describe("Permissions RBAC", () => {
  it("admin can manage users", () => {
    expect(roleGrants(UserRole.Admin, PermissionAction.UserCreate)).toBe(true);
    expect(roleGrants(UserRole.Admin, PermissionAction.DeviceRevoke)).toBe(true);
  });

  it("user cannot perform admin actions", () => {
    expect(roleGrants(UserRole.User, PermissionAction.UserCreate)).toBe(false);
    expect(() => assertPermission(UserRole.User, PermissionAction.UserDelete)).toThrow(PermissionError);
  });

  it("user can chat and call", () => {
    expect(roleGrants(UserRole.User, PermissionAction.ChatSend)).toBe(true);
    expect(roleGrants(UserRole.User, PermissionAction.CallInitiate)).toBe(true);
  });
});
