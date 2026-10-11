import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as SQLiteConnection, SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import * as demo from "./data.js";
import { migrations } from "./database-schema.js";
import { accountSnapshotSchema, resourceSnapshotSchema } from "./storage-schemas.js";
import type { AuditEvent, ClientRecord, Message, Questionnaire, QuestionnaireAssignment,
  QuestionnaireResponse, Resource, ResourceAssignment, User } from "./types.js";

// Vite 5 / Vitest 2 do not recognize this recent built-in in their ESM resolver.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export const dataDirectory = fileURLToPath(new URL(import.meta.url.includes("/dist/") ? "../../data/" : "../data/", import.meta.url));
export const defaultDatabaseFile = process.env.DATABASE_FILE ?? join(dataDirectory, "lecurseur.sqlite");
export const defaultResourceDirectory = process.env.RESOURCES_DIRECTORY ?? join(dataDirectory, "resources");

type Tables = {
  users: User; clients: ClientRecord; resources: Resource; resource_assignments: ResourceAssignment;
  credentials: { userId: string; hash: string };
  invitations: { userId: string; digest: string; expiresAt: number };
  questionnaires: Questionnaire; questionnaire_assignments: QuestionnaireAssignment;
  questionnaire_responses: QuestionnaireResponse; messages: Message; audit_events: AuditEvent;
};
type Table = keyof Tables;
const columns: { [K in Table]: readonly (keyof Tables[K] & string)[] } = {
  users: ["id", "email", "displayName", "role", "clientId", "invitedBy", "invitationStatus"],
  clients: ["id", "displayName", "email", "status", "createdAt", "tags", "assignedPractitionerId", "careNotesSummary", "rgpdConsent"],
  credentials: ["userId", "hash"], invitations: ["userId", "digest", "expiresAt"],
  resources: ["id", "title", "description", "type", "url", "uploadedAt", "sensitivity", "fileName", "mimeType", "size"],
  resource_assignments: ["id", "clientId", "resourceId", "assignedAt", "assignedBy", "note"],
  questionnaires: ["id", "title", "version", "status", "sensitivity", "questions", "description", "createdBy", "createdAt"],
  questionnaire_assignments: ["id", "clientId", "questionnaireId", "dueAt", "status", "note", "assignedBy", "assignedAt"],
  questionnaire_responses: ["id", "assignmentId", "clientId", "submittedAt", "answers"],
  messages: ["id", "threadId", "senderId", "clientId", "body", "createdAt", "attachments"],
  audit_events: ["id", "actorId", "action", "target", "createdAt", "metadata"]
};
const jsonFields = new Set(["tags", "rgpdConsent", "questions", "answers", "attachments", "metadata"]);

export type DatabaseOptions = {
  file?: string;
  legacyAccountsFile?: string | null;
  resourceDirectory?: string;
  seedDemo?: boolean;
};

export class AppDatabase {
  private connection: SQLiteConnection;
  readonly file: string;
  readonly resourceDirectory: string;

  constructor(options: DatabaseOptions = {}) {
    this.file = options.file ?? (process.env.VITEST ? ":memory:" : defaultDatabaseFile);
    this.resourceDirectory = options.resourceDirectory ?? defaultResourceDirectory;
    if (this.file !== ":memory:") mkdirSync(dirname(this.file), { recursive: true });
    this.connection = new DatabaseSync(this.file);
    try {
      this.connection.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
      this.migrate();
      this.initialize(options);
    } catch (error) {
      this.connection.close();
      throw error;
    }
  }

  // The callback must be synchronous: all related writes commit or roll back together.
  transaction<T>(operation: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  private migrate() {
    this.transaction(() => {
      this.connection.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, appliedAt TEXT NOT NULL) STRICT");
      const applied = this.connection.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
      if (applied.some((row) => Number(row.version) > migrations[migrations.length - 1].version)) {
        throw new Error("La base utilise une version plus recente de l'application.");
      }
      for (const migration of migrations) {
        if (applied.some((row) => row.version === migration.version)) continue;
        this.connection.exec(migration.sql);
        this.connection.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(migration.version, new Date().toISOString());
      }
    });
  }

  private initialize(options: DatabaseOptions) {
    this.transaction(() => {
      if (this.connection.prepare("SELECT value FROM app_metadata WHERE key = 'initialized'").get()) return;
      // Isolated databases used by tests never import the working application's private files.
      const accountsFile = options.legacyAccountsFile === undefined
        ? (this.file === ":memory:" ? null : process.env.ACCOUNTS_FILE ?? join(dataDirectory, "accounts.json"))
        : options.legacyAccountsFile;
      const legacy = accountsFile && existsSync(accountsFile)
        ? accountSnapshotSchema.parse(JSON.parse(readFileSync(accountsFile, "utf8"))) : null;
      const seedDemo = options.seedDemo ?? true;
      const users = legacy?.users ?? (seedDemo ? demo.users : []);
      const clients = legacy?.clients ?? (seedDemo ? demo.clients : []);
      for (const user of users) this.insert("users", user);
      for (const client of clients) this.insert("clients", client);
      if (legacy) {
        for (const [userId, hash] of Object.entries(legacy.credentials)) this.insert("credentials", { userId, hash });
        for (const invitation of legacy.invitations) this.insert("invitations", invitation);
      } else {
        for (const user of users.filter((item) => item.invitationStatus === "accepted")) {
          const salt = randomBytes(16).toString("hex");
          const hash = `${salt}:${scryptSync(demo.demoPassword, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex")}`;
          this.insert("credentials", { userId: user.id, hash });
        }
      }
      if (seedDemo) {
        for (const questionnaire of demo.questionnaires) this.insert("questionnaires", questionnaire);
        for (const assignment of demo.questionnaireAssignments.filter((item) => clients.some((client) => client.id === item.clientId))) {
          this.insert("questionnaire_assignments", assignment);
        }
        for (const message of demo.messages.filter((item) => clients.some((client) => client.id === item.clientId) && users.some((user) => user.id === item.senderId))) {
          this.insert("messages", message);
        }
      }
      // Import the old catalogue once, in the same transaction as accounts and permissions.
      const indexFile = join(this.resourceDirectory, "index.json");
      if ((this.file !== ":memory:" || options.resourceDirectory) && existsSync(indexFile)) {
        const saved = resourceSnapshotSchema.parse(JSON.parse(readFileSync(indexFile, "utf8")));
        for (const resource of saved.resources) {
          if (!existsSync(join(this.resourceDirectory, `${resource.id}.bin`))) throw new Error(`Fichier de ressource manquant : ${resource.id}`);
          this.insert("resources", resource);
        }
        for (const assignment of saved.assignments) this.insert("resource_assignments", assignment);
      }
      this.connection.prepare("INSERT INTO app_metadata VALUES ('initialized', ?)").run(new Date().toISOString());
    });
  }

  private where<K extends Table>(table: K, filter: Partial<Tables[K]>) {
    const entries = Object.entries(filter);
    if (entries.some(([key]) => !(columns[table] as readonly string[]).includes(key))) throw new Error("Colonne inconnue");
    return {
      clause: entries.length ? ` WHERE ${entries.map(([key]) => `"${key}" = ?`).join(" AND ")}` : "",
      values: entries.map(([, value]) => value as SQLInputValue)
    };
  }

  list<K extends Table>(table: K, filter: Partial<Tables[K]> = {}): Tables[K][] {
    const { clause, values } = this.where(table, filter);
    const order = table === "audit_events" ? "createdAt DESC, rowid DESC" : "rowid";
    return this.connection.prepare(`SELECT * FROM "${table}"${clause} ORDER BY ${order}`).all(...values).map((row) => {
      const item: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (value !== null) item[key] = jsonFields.has(key) ? JSON.parse(String(value)) : value;
      }
      return item as Tables[K];
    });
  }

  find<K extends Table>(table: K, filter: Partial<Tables[K]>): Tables[K] | undefined {
    return this.list(table, filter)[0];
  }

  insert<K extends Table>(table: K, item: Tables[K]) { this.write(table, item, false); }
  put<K extends Table>(table: K, item: Tables[K]) { this.write(table, item, true); }

  private write<K extends Table>(table: K, item: Tables[K], upsert: boolean) {
    const fields = columns[table] as readonly string[];
    const record = item as unknown as Record<string, unknown>;
    const values = fields.map((field) => record[field] === undefined ? null : jsonFields.has(field) ? JSON.stringify(record[field]) : record[field] as SQLInputValue);
    const conflict = upsert ? ` ON CONFLICT("${fields[0]}") DO UPDATE SET ${fields.slice(1).map((field) => `"${field}" = excluded."${field}"`).join(",")}` : "";
    this.connection.prepare(`INSERT INTO "${table}" (${fields.map((field) => `"${field}"`).join(",")}) VALUES (${fields.map(() => "?").join(",")})${conflict}`).run(...values);
  }

  remove<K extends Table>(table: K, filter: Partial<Tables[K]>) {
    const { clause, values } = this.where(table, filter);
    if (!clause) throw new Error("Un filtre est requis pour supprimer des donnees.");
    this.connection.prepare(`DELETE FROM "${table}"${clause}`).run(...values);
  }

  addAudit(actorId: string, action: string, target: string, metadata: Record<string, string> = {}) {
    this.insert("audit_events", { id: nanoid(), actorId, action, target, metadata, createdAt: new Date().toISOString() });
  }

  check() {
    const integrity = this.connection.prepare("PRAGMA integrity_check").all();
    const foreignKeys = this.connection.prepare("PRAGMA foreign_key_check").all();
    return { ok: integrity.length === 1 && integrity[0].integrity_check === "ok" && foreignKeys.length === 0, integrity, foreignKeys };
  }

  backup(destination: string) {
    if (existsSync(destination)) throw new Error("Le fichier de sauvegarde existe deja.");
    mkdirSync(dirname(destination), { recursive: true });
    this.connection.prepare("VACUUM INTO ?").run(destination);
  }

  close() { this.connection.close(); }
}
