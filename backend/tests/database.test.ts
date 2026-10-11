import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountStore } from "../src/accounts.js";
import { createApp } from "../src/app.js";
import { signUser } from "../src/auth.js";
import { AppDatabase } from "../src/database.js";
import { migrations } from "../src/database-schema.js";
import { clients, users } from "../src/data.js";
import type { User } from "../src/types.js";

describe("SQLite persistence and migration", () => {
  let directory: string;
  let connections: AppDatabase[];
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "curseur-db-test-"));
    connections = [];
  });
  afterEach(() => {
    connections.forEach((database) => database.close());
    if (!directory.startsWith(join(tmpdir(), "curseur-db-test-"))) throw new Error("Unexpected directory");
    rmSync(directory, { recursive: true, force: true });
  });
  function open(extra: ConstructorParameters<typeof AppDatabase>[0] = {}) {
    const database = new AppDatabase({ file: join(directory, "test.sqlite"), legacyAccountsFile: null,
      resourceDirectory: join(directory, "resources"), ...extra });
    connections.push(database);
    return database;
  }
  function close(database: AppDatabase) {
    database.close();
    connections.splice(connections.indexOf(database), 1);
  }

  it("upgrades a version 1 database without losing questionnaire content and persists the new fields", () => {
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
    const file = join(directory, "test.sqlite");
    const legacy = new DatabaseSync(file);
    legacy.exec(migrations[0].sql);
    legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, appliedAt TEXT NOT NULL) STRICT");
    legacy.prepare("INSERT INTO schema_migrations VALUES (1, ?)").run(new Date().toISOString());
    legacy.prepare("INSERT INTO app_metadata VALUES ('initialized', ?)").run(new Date().toISOString());
    legacy.prepare("INSERT INTO questionnaires VALUES (?, ?, ?, ?, ?, ?)").run(
      "legacy-q", "Ancienne échelle", 2, "published", "health",
      JSON.stringify([{ id: "old", label: "Confort", type: "scale", required: true }])
    );
    legacy.close();
    const upgraded = open({ seedDemo: false });
    const previous = upgraded.find("questionnaires", { id: "legacy-q" })!;
    expect(previous.questions[0]).toEqual({ id: "old", label: "Confort", type: "scale", required: true });
    upgraded.insert("users", users[1]);
    upgraded.put("questionnaires", { ...previous, description: "Consigne conservée", createdBy: users[1].id,
      questions: [{ ...previous.questions[0], min: 1, max: 10 }] });
    close(upgraded);
    const reopened = open({ seedDemo: false });
    expect(reopened.find("questionnaires", { id: "legacy-q" })).toMatchObject({
      title: "Ancienne échelle", version: 2, description: "Consigne conservée", createdBy: users[1].id,
      questions: [{ min: 1, max: 10 }]
    });
    expect(reopened.check().ok).toBe(true);
  });

  it("imports legacy accounts, hashes, pending invitations and file permissions exactly once", async () => {
    const accountsFile = join(directory, "accounts.json");
    const resources = join(directory, "resources");
    mkdirSync(resources);
    const token = "a".repeat(64);
    const password = "MigrationPersonnelle!2026";
    // Obtain a genuine credential using the same flow as a real activated profile.
    const source = open({ file: ":memory:" });
    const store = new AccountStore(source);
    const pending: User = { id: "u-migration", displayName: "Compte migre", email: "migration@example.test",
      role: "praticien", invitationStatus: "pending", invitedBy: "u-admin" };
    const invited = store.createInvitation(pending);
    const activationToken = new URLSearchParams(new URL(invited.url).hash.slice(1)).get("invitation")!;
    await store.acceptInvitation(activationToken, password);
    const migratedUsers = source.list("users");
    const snapshot = { version: 1, users: migratedUsers, clients,
      credentials: Object.fromEntries(source.list("credentials").map((item) => [item.userId, item.hash])),
      invitations: [{ userId: "u-noa", digest: createHash("sha256").update(token).digest("hex"), expiresAt: Date.now() + 3600000 }] };
    writeFileSync(accountsFile, JSON.stringify(snapshot));
    const resource = { id: "r-11111111-1111-4111-8111-111111111111", title: "Ancien fichier", description: "Import",
      type: "pdf", url: "/api/resources/legacy/file", uploadedAt: new Date().toISOString(), sensitivity: "standard",
      fileName: "ancien.pdf", mimeType: "application/pdf", size: 9 };
    const bytes = Buffer.from("%PDF-1.4\n");
    writeFileSync(join(resources, `${resource.id}.bin`), bytes);
    const catalogue = { version: 1, resources: [resource], assignments: [{ id: "legacy-assignment", resourceId: resource.id,
      clientId: "c-camille", assignedBy: "u-praticienne", assignedAt: resource.uploadedAt, note: "Ancienne consigne" }] };
    writeFileSync(join(resources, "index.json"), JSON.stringify(catalogue));
    const before = readFileSync(accountsFile);
    const database = open({ legacyAccountsFile: accountsFile });
    expect(database.list("users")).toEqual(migratedUsers);
    expect(database.list("resource_assignments")).toEqual(catalogue.assignments);
    expect(await new AccountStore(database).verifyPassword(database.find("users", { id: pending.id })!, password)).toBe(true);
    expect(new AccountStore(database).resolveInvitation(token)?.user.id).toBe("u-noa");
    expect(readFileSync(accountsFile)).toEqual(before);
    expect(readFileSync(join(resources, `${resource.id}.bin`))).toEqual(bytes);
    database.remove("resource_assignments", { id: "legacy-assignment" });
    close(database);
    // Once imported, stale JSON cannot restore access or replace current data.
    writeFileSync(accountsFile, "invalid old file");
    const reopened = open({ legacyAccountsFile: accountsFile });
    expect(reopened.list("resource_assignments")).toEqual([]);
    expect(reopened.list("users")).toHaveLength(migratedUsers.length);
    expect(reopened.check().ok).toBe(true);
  });

  it("fails visibly on invalid legacy files and rolls back a failed import before retrying", () => {
    const file = join(directory, "accounts.json");
    writeFileSync(file, "broken JSON");
    expect(() => open({ legacyAccountsFile: file })).toThrow();
    writeFileSync(file, JSON.stringify({ version: 1, users, clients: [{ ...clients[0], assignedPractitionerId: "missing" }], credentials: {}, invitations: [] }));
    expect(() => open({ legacyAccountsFile: file })).toThrow(/FOREIGN KEY/);
    writeFileSync(file, JSON.stringify({ version: 1, users, clients, credentials: {}, invitations: [] }));
    const database = open({ legacyAccountsFile: file });
    expect(database.list("users")).toHaveLength(users.length);
    expect(database.check().ok).toBe(true);
  });

  it("enforces email uniqueness and relationships and rolls back every write in a failed transaction", () => {
    const database = open();
    expect(() => database.insert("users", { ...users[0], id: "duplicate", email: users[0].email.toUpperCase() })).toThrow(/UNIQUE/);
    expect(() => database.transaction(() => {
      database.insert("users", { ...users[0], id: "rolled-back", email: "rollback@example.test" });
      database.insert("messages", { id: "invalid", threadId: "t", senderId: "rolled-back", clientId: "missing",
        body: "Impossible", createdAt: new Date().toISOString(), attachments: [] });
    })).toThrow(/FOREIGN KEY/);
    expect(database.find("users", { id: "rolled-back" })).toBeUndefined();
    expect(database.find("messages", { id: "invalid" })).toBeUndefined();
    expect(database.check().ok).toBe(true);
  });

  it("persists messages, questionnaire answers and audit across close/reopen and isolates spaces", async () => {
    const database = open();
    const app = createApp({ database });
    const authorization = `Bearer ${signUser(database.find("users", { id: "u-camille" })!)}`;
    const message = await request(app).post("/messages").set("Authorization", authorization)
      .send({ clientId: "c-camille", body: "Message conserve apres redemarrage" });
    expect(message.status).toBe(201);
    const response = await request(app).post("/questionnaires/responses").set("Authorization", authorization)
      .send({ assignmentId: "qa-camille-1", answers: { q1: "Reponse conservee", q2: 3 } });
    expect(response.status).toBe(201);
    close(database);
    const reopened = open();
    const restarted = createApp({ database: reopened });
    expect((await request(restarted).get("/messages").set("Authorization", authorization)).body.messages).toContainEqual(message.body.message);
    const questionnaires = await request(restarted).get("/questionnaires").set("Authorization", authorization);
    expect(questionnaires.body.responses).toContainEqual(response.body.response);
    expect(questionnaires.body.assignments[0].status).toBe("submitted");
    expect(reopened.list("audit_events").map((event) => event.action)).toEqual(expect.arrayContaining(["message.created", "questionnaire.submitted"]));
    const other: User = { id: "u-other", email: "other@example.test", displayName: "Autre praticien", role: "praticien", invitationStatus: "accepted" };
    reopened.insert("users", other);
    const otherAuthorization = `Bearer ${signUser(other)}`;
    expect((await request(restarted).get("/messages").set("Authorization", otherAuthorization)).body.messages).toEqual([]);
    expect((await request(restarted).get("/clients").set("Authorization", otherAuthorization)).body.clients).toEqual([]);
    expect((await request(restarted).post("/messages").set("Authorization", otherAuthorization).send({ clientId: "c-camille", body: "Interdit" })).status).toBe(400);
  });

  it("shares fresh data across connections and consumes invitations once across concurrent activations", async () => {
    const first = open();
    const second = open();
    const pending: User = { id: "shared", displayName: "Compte partage", email: "shared@example.test", role: "praticien", invitationStatus: "pending", invitedBy: "u-admin" };
    const invitation = new AccountStore(first).createInvitation(pending);
    const token = new URLSearchParams(new URL(invitation.url).hash.slice(1)).get("invitation")!;
    expect(second.find("users", { id: pending.id })).toEqual(pending);
    const results = await Promise.all([first, second].map((database) => new AccountStore(database).acceptInvitation(token, "MotDePassePersonnel!42")));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(first.find("users", { id: pending.id })?.invitationStatus).toBe("accepted");
    expect(second.list("invitations", { userId: pending.id })).toEqual([]);
  });

  it("creates a consistent backup that reopens with all records and refuses overwriting it", () => {
    const database = open();
    database.addAudit("u-admin", "backup.test", "database");
    const destination = join(directory, "backup.sqlite");
    database.backup(destination);
    expect(() => database.backup(destination)).toThrow(/existe deja/);
    const backup = open({ file: destination });
    expect(backup.check().ok).toBe(true);
    expect(backup.list("users")).toEqual(database.list("users"));
    expect(backup.list("audit_events")).toEqual(database.list("audit_events"));
  });
});
