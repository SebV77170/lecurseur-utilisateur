// Append migrations here; applied versions are recorded in schema_migrations.
export const migrations = [{ version: 1, sql: `
  CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    displayName TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','praticien','client')),
    clientId TEXT UNIQUE REFERENCES clients(id) DEFERRABLE INITIALLY DEFERRED,
    invitedBy TEXT REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
    invitationStatus TEXT NOT NULL CHECK(invitationStatus IN ('pending','accepted'))
  ) STRICT;
  CREATE TABLE clients (
    id TEXT PRIMARY KEY, displayName TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('active','paused','archived')), createdAt TEXT NOT NULL,
    tags TEXT NOT NULL CHECK(json_valid(tags)),
    assignedPractitionerId TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED,
    careNotesSummary TEXT NOT NULL, rgpdConsent TEXT NOT NULL CHECK(json_valid(rgpdConsent))
  ) STRICT;
  CREATE INDEX clients_practitioner ON clients(assignedPractitionerId);
  CREATE TABLE credentials (
    userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    hash TEXT NOT NULL
  ) STRICT;
  CREATE TABLE invitations (
    userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    digest TEXT NOT NULL UNIQUE, expiresAt INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE resources (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('pdf','audio','image')), url TEXT NOT NULL,
    uploadedAt TEXT NOT NULL, sensitivity TEXT NOT NULL CHECK(sensitivity IN ('standard','sensitive')),
    fileName TEXT NOT NULL, mimeType TEXT NOT NULL, size INTEGER NOT NULL CHECK(size > 0)
  ) STRICT;
  CREATE TABLE resource_assignments (
    id TEXT PRIMARY KEY, clientId TEXT NOT NULL REFERENCES clients(id),
    resourceId TEXT NOT NULL REFERENCES resources(id), assignedAt TEXT NOT NULL,
    assignedBy TEXT NOT NULL REFERENCES users(id), note TEXT NOT NULL,
    UNIQUE(resourceId, clientId)
  ) STRICT;
  CREATE INDEX resource_assignments_client ON resource_assignments(clientId);
  CREATE TABLE questionnaires (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0),
    status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),
    sensitivity TEXT NOT NULL CHECK(sensitivity IN ('standard','health')),
    questions TEXT NOT NULL CHECK(json_valid(questions))
  ) STRICT;
  CREATE TABLE questionnaire_assignments (
    id TEXT PRIMARY KEY, clientId TEXT NOT NULL REFERENCES clients(id),
    questionnaireId TEXT NOT NULL REFERENCES questionnaires(id), dueAt TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('todo','submitted','reviewed')),
    UNIQUE(id, clientId)
  ) STRICT;
  CREATE INDEX questionnaire_assignments_client ON questionnaire_assignments(clientId);
  CREATE TABLE questionnaire_responses (
    id TEXT PRIMARY KEY, assignmentId TEXT NOT NULL, clientId TEXT NOT NULL,
    submittedAt TEXT NOT NULL, answers TEXT NOT NULL CHECK(json_valid(answers)),
    FOREIGN KEY(assignmentId, clientId) REFERENCES questionnaire_assignments(id, clientId)
  ) STRICT;
  CREATE INDEX questionnaire_responses_client ON questionnaire_responses(clientId);
  CREATE TABLE messages (
    id TEXT PRIMARY KEY, threadId TEXT NOT NULL, senderId TEXT NOT NULL REFERENCES users(id),
    clientId TEXT NOT NULL REFERENCES clients(id), body TEXT NOT NULL, createdAt TEXT NOT NULL,
    attachments TEXT NOT NULL CHECK(json_valid(attachments))
  ) STRICT;
  CREATE INDEX messages_client_date ON messages(clientId, createdAt);
  CREATE TABLE audit_events (
    id TEXT PRIMARY KEY, actorId TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
    target TEXT NOT NULL, createdAt TEXT NOT NULL, metadata TEXT NOT NULL CHECK(json_valid(metadata))
  ) STRICT;
  CREATE INDEX audit_events_date ON audit_events(createdAt);
  CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
` }, { version: 2, sql: `
  ALTER TABLE questionnaires ADD COLUMN description TEXT;
  ALTER TABLE questionnaires ADD COLUMN createdBy TEXT REFERENCES users(id);
  ALTER TABLE questionnaires ADD COLUMN createdAt TEXT;
  ALTER TABLE questionnaire_assignments ADD COLUMN note TEXT;
  ALTER TABLE questionnaire_assignments ADD COLUMN assignedBy TEXT REFERENCES users(id);
  ALTER TABLE questionnaire_assignments ADD COLUMN assignedAt TEXT;
` }];
