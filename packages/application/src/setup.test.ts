import { describe, expect, it } from "vitest";
import { DatabaseContext, SqliteConnection } from "@lockal/database";
import { UserRole } from "@lockal/domain";
import { SetupService } from "./setup-service.js";

describe("Organization setup", () => {
  it("creates organization, admin, device identity", async () => {
    const connection = await SqliteConnection.open(true);
    const db = new DatabaseContext(connection);
    const setup = new SetupService(db);

    const result = await setup.createOrganization({
      organizationName: "Test Org",
      adminUsername: "root",
      adminDisplayName: "Root Admin",
      adminPassword: "strong-password",
      deviceName: "Dev Machine",
      platform: "win32",
      appVersion: "0.1.0",
    });

    expect(result.organizationFingerprint).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(result.deviceFingerprint).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);

    const org = db.organizations.getById(result.organizationId);
    expect(org?.name).toBe("Test Org");

    const admin = db.users.findByUsername(result.organizationId, "root");
    expect(admin?.role).toBe(UserRole.Admin);

    const devices = db.devices.listByUser(result.userId);
    expect(devices).toHaveLength(1);
    expect(devices[0]?.trustStatus).toBe("trusted");
  });
});
