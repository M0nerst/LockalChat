import type { DatabaseContext } from "@lockal/database";
import { AuditEventType, DeviceTrustStatus } from "@lockal/domain";
import type { Device, User } from "@lockal/domain";
import { PermissionAction, assertPermission, roleGrants } from "@lockal/permissions";
import { PermissionError } from "@lockal/shared";
import type { DeviceId, OrganizationId } from "@lockal/shared";
import { isoNow } from "@lockal/shared";

export class DeviceAdminService {
  constructor(private readonly db: DatabaseContext) {}

  listDevices(actor: User, organizationId: OrganizationId): Device[] {
    if (!roleGrants(actor.role, PermissionAction.DeviceList)) {
      throw new PermissionError(PermissionAction.DeviceList);
    }
    if (actor.organizationId !== organizationId) {
      throw new PermissionError(PermissionAction.DeviceList);
    }
    return this.db.devices.listByOrganization(organizationId);
  }

  revokeDevice(actor: User, deviceId: DeviceId): void {
    assertPermission(actor.role, PermissionAction.DeviceRevoke);
    const device = this.db.devices.findById(deviceId);
    if (!device || device.organizationId !== actor.organizationId) {
      throw new Error("Device not found");
    }
    this.db.devices.updateTrust(deviceId, DeviceTrustStatus.Revoked);
    this.db.audit.append({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      actorDeviceId: null,
      eventType: AuditEventType.DeviceRevoked,
      detailsJson: JSON.stringify({ deviceId }),
      createdAt: isoNow(),
    });
  }
}
