import { describe, expect, it } from "vitest";
import { DatabaseContext, SqliteConnection } from "@lockal/database";
import { UserRole } from "@lockal/domain";
import { AuthError } from "@lockal/shared";
import { AuthService } from "./auth-service.js";
import { SetupService } from "./setup-service.js";
import { UserAdminService } from "./user-admin-service.js";

async function freshDb() {
  const connection = await SqliteConnection.open(true);
  return new DatabaseContext(connection);
}

describe("Authentication", () => {
  it("login succeeds with valid credentials", async () => {
    const db = await freshDb();
    const setup = new SetupService(db);
    const created = await setup.createOrganization({
      organizationName: "Acme LAN",
      adminUsername: "admin",
      adminDisplayName: "Admin",
      adminPassword: "secret123",
      deviceName: "PC-1",
      platform: "win32",
      appVersion: "0.1.0",
    });

    const auth = new AuthService(db);
    const ctx = auth.login({
      organizationId: created.organizationId,
      username: "admin",
      password: "secret123",
      deviceId: created.deviceId,
    });

    expect(ctx.user.username).toBe("admin");
    expect(ctx.sessionToken.length).toBeGreaterThan(10);
  });

  it("login fails with wrong password", async () => {
    const db = await freshDb();
    const setup = new SetupService(db);
    const created = await setup.createOrganization({
      organizationName: "Acme",
      adminUsername: "admin",
      adminDisplayName: "Admin",
      adminPassword: "correct",
      deviceName: "PC",
      platform: "linux",
      appVersion: "0.1.0",
    });

    const auth = new AuthService(db);
    expect(() =>
      auth.login({
        organizationId: created.organizationId,
        username: "admin",
        password: "wrong",
        deviceId: created.deviceId,
      }),
    ).toThrow(AuthError);
  });

  it("locked account cannot login", async () => {
    const db = await freshDb();
    const setup = new SetupService(db);
    const created = await setup.createOrganization({
      organizationName: "Acme",
      adminUsername: "admin",
      adminDisplayName: "Admin",
      adminPassword: "pass",
      deviceName: "PC",
      platform: "darwin",
      appVersion: "0.1.0",
    });

    const auth = new AuthService(db);
    const admin = auth.login({
      organizationId: created.organizationId,
      username: "admin",
      password: "pass",
      deviceId: created.deviceId,
    });

    const adminService = new UserAdminService(db);
    const employee = adminService.createUser(admin.user, {
      username: "ivan",
      displayName: "Ivan",
      password: "ivan-pass",
      role: UserRole.User,
    });

    adminService.blockUser(admin.user, employee.id);

    expect(() =>
      auth.login({
        organizationId: created.organizationId,
        username: "ivan",
        password: "ivan-pass",
        deviceId: created.deviceId,
      }),
    ).toThrow(AuthError);
  });
});
