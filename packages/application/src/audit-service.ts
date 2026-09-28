import type { DatabaseContext } from "@lockal/database";
import type { AuditLogEntry, User } from "@lockal/domain";
import { PermissionAction, roleGrants } from "@lockal/permissions";
import { PermissionError } from "@lockal/shared";
import type { OrganizationId } from "@lockal/shared";

export class AuditService {
  constructor(private readonly db: DatabaseContext) {}

  list(actor: User, organizationId: OrganizationId, limit = 100): AuditLogEntry[] {
    if (!roleGrants(actor.role, PermissionAction.AuditLogView)) {
      throw new PermissionError(PermissionAction.AuditLogView);
    }
    return this.db.audit.list(organizationId, limit);
  }
}
