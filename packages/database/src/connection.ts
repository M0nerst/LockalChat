import initSqlJs, { type Database } from "sql.js";
import {
  MIGRATION_V1,
  MIGRATION_V2,
  MIGRATION_V3,
  MIGRATION_V4,
  MIGRATION_V5,
  MIGRATION_V6,
  MIGRATION_V7,
  MIGRATION_V8,
  SCHEMA_VERSION,
} from "./schema.js";

let sqlJsInit: ReturnType<typeof initSqlJs> | null = null;

async function getSqlJs() {
  if (!sqlJsInit) {
    if (typeof window !== "undefined") {
      sqlJsInit = initSqlJs({
        locateFile: (file) => (file.endsWith(".wasm") ? "/sql-wasm.wasm" : file),
      });
    } else {
      sqlJsInit = initSqlJs();
    }
  }
  return sqlJsInit;
}

export class SqliteConnection {
  private db: Database;

  private constructor(db: Database) {
    this.db = db;
  }

  static async open(_inMemory = true, bytes?: Uint8Array): Promise<SqliteConnection> {
    const SQL = await getSqlJs();
    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    const conn = new SqliteConnection(db);
    await conn.migrate();
    return conn;
  }

  private async migrate(): Promise<void> {
    this.db.run(MIGRATION_V1);
    let version = 0;
    const existing = this.db.exec("SELECT version FROM schema_meta LIMIT 1");
    if (existing.length > 0 && existing[0]!.values.length > 0) {
      version = Number(existing[0]!.values[0]![0]);
    } else {
      this.db.run("INSERT INTO schema_meta (version) VALUES (?)", [1]);
      version = 1;
    }
    if (version < 2) {
      this.db.run(MIGRATION_V2);
      version = 2;
      this.db.run("UPDATE schema_meta SET version = ?", [2]);
    }
    if (version < 3) {
      this.db.run(MIGRATION_V3);
      version = 3;
      this.db.run("UPDATE schema_meta SET version = ?", [3]);
    }
    if (version < 4) {
      this.db.run(MIGRATION_V4);
      version = 4;
      this.db.run("UPDATE schema_meta SET version = ?", [4]);
    }
    if (version < 5) {
      this.db.run(MIGRATION_V5);
      version = 5;
      this.db.run("UPDATE schema_meta SET version = ?", [5]);
    }
    if (version < 6) {
      this.db.run(MIGRATION_V6);
      version = 6;
      this.db.run("UPDATE schema_meta SET version = ?", [6]);
    }
    if (version < 7) {
      this.db.run(MIGRATION_V7);
      version = 7;
      this.db.run("UPDATE schema_meta SET version = ?", [7]);
    }
    if (version < 8) {
      this.db.run(MIGRATION_V8);
      version = 8;
      this.db.run("UPDATE schema_meta SET version = ?", [SCHEMA_VERSION]);
    }
  }

  exec(sql: string, params: unknown[] = []): void {
    this.db.run(sql, params as (string | number | null)[]);
  }

  get<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
    const stmt = this.db.prepare(sql);
    stmt.bind(params as (string | number | null)[]);
    if (!stmt.step()) {
      stmt.free();
      return null;
    }
    const row = stmt.getAsObject() as T;
    stmt.free();
    return row;
  }

  all<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    const results: T[] = [];
    const stmt = this.db.prepare(sql);
    stmt.bind(params as (string | number | null)[]);
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return results;
  }

  exportBytes(): Uint8Array {
    return this.db.export();
  }

  close(): void {
    this.db.close();
  }
}
