import type { Organization } from "@lockal/domain";
import type { OrganizationId } from "@lockal/shared";
import type { SqliteConnection } from "../connection.js";

type OrgRow = {
  id: string;
  name: string;
  public_key: string;
  private_key_encrypted: string | null;
  fingerprint: string;
  created_at: string;
};

function mapOrg(row: OrgRow): Organization {
  return {
    id: row.id as OrganizationId,
    name: row.name,
    publicKey: row.public_key,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
  };
}

export class OrganizationRepository {
  constructor(private readonly db: SqliteConnection) {}

  create(org: Organization, privateKeyEncrypted: string | null): void {
    this.db.exec(
      `INSERT INTO organizations (id, name, public_key, private_key_encrypted, fingerprint, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [org.id, org.name, org.publicKey, privateKeyEncrypted, org.fingerprint, org.createdAt],
    );
  }

  getById(id: OrganizationId): Organization | null {
    const row = this.db.get<OrgRow>("SELECT * FROM organizations WHERE id = ?", [id]);
    return row ? mapOrg(row) : null;
  }

  getFirst(): Organization | null {
    const row = this.db.get<OrgRow>("SELECT * FROM organizations LIMIT 1");
    return row ? mapOrg(row) : null;
  }

  getEncryptedPrivateKey(id: OrganizationId): string | null {
    const row = this.db.get<{ private_key_encrypted: string | null }>(
      "SELECT private_key_encrypted FROM organizations WHERE id = ?",
      [id],
    );
    return row?.private_key_encrypted ?? null;
  }
}
