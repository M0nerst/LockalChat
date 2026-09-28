import type { SqliteConnection } from "./connection.js";
import { AuditRepository } from "./repositories/audit-repository.js";
import { DeviceRepository } from "./repositories/device-repository.js";
import { OrganizationRepository } from "./repositories/organization-repository.js";
import { SessionRepository } from "./repositories/session-repository.js";
import { UserRepository } from "./repositories/user-repository.js";

export class DatabaseContext {
  readonly organizations: OrganizationRepository;
  readonly users: UserRepository;
  readonly devices: DeviceRepository;
  readonly sessions: SessionRepository;
  readonly audit: AuditRepository;

  constructor(readonly connection: SqliteConnection) {
    this.organizations = new OrganizationRepository(connection);
    this.users = new UserRepository(connection);
    this.devices = new DeviceRepository(connection);
    this.sessions = new SessionRepository(connection);
    this.audit = new AuditRepository(connection);
  }

  export(): Uint8Array {
    return this.connection.exportBytes();
  }
}
