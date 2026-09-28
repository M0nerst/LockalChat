import type { AuditLogEntry } from "@lockal/domain";
import type { OrganizationId } from "@lockal/shared";
import { generateId } from "@lockal/shared";
import type { SqliteConnection } from "../connection.js";

export class AuditRepository {
  constructor(private readonly db: SqliteConnection) {}

  append(entry: Omit<AuditLogEntry, "id">): AuditLogEntry {
    const id = generateId("aud");
    this.db.exec(
      `INSERT INTO audit_logs (id, organization_id, actor_user_id, actor_device_id, event_type, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.organizationId,
        entry.actorUserId,
        entry.actorDeviceId,
        entry.eventType,
        entry.detailsJson,
        entry.createdAt,
      ],
    );
    return { ...entry, id };
  }

  list(organizationId: OrganizationId, limit = 100): AuditLogEntry[] {
    return this.db
      .all<{
        id: string;
        organization_id: string;
        actor_user_id: string | null;
        actor_device_id: string | null;
        event_type: string;
        details_json: string;
        created_at: string;
      }>("SELECT * FROM audit_logs WHERE organization_id = ? ORDER BY created_at DESC LIMIT ?", [
        organizationId,
        limit,
      ])
      .map((row) => ({
        id: row.id,
        organizationId: row.organization_id as OrganizationId,
        actorUserId: row.actor_user_id as AuditLogEntry["actorUserId"],
        actorDeviceId: row.actor_device_id as AuditLogEntry["actorDeviceId"],
        eventType: row.event_type,
        detailsJson: row.details_json,
        createdAt: row.created_at,
      }));
  }
}
