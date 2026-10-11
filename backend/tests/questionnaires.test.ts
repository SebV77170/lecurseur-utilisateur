import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { signUser } from "../src/auth.js";
import { AppDatabase } from "../src/database.js";
import type { Question, User } from "../src/types.js";

describe("questionnaire creation and patient responses", () => {
  let database: AppDatabase;
  let app: ReturnType<typeof createApp>;
  let practitioner: string;
  let patient: string;
  let other: string;
  const questions: Question[] = [
    { id: "short", label: "Texte", type: "text", required: true, maxLength: 30 },
    { id: "long", label: "Commentaire", type: "textarea", required: false },
    { id: "single", label: "Choix unique", type: "choice", required: true, options: ["A", "B"] },
    { id: "multi", label: "Choix multiples", type: "multiple", required: true, options: ["A", "B", "C"], min: 1, max: 2 },
    { id: "scale", label: "Confort", type: "scale", required: true, min: 1, max: 10 },
    { id: "number", label: "Nombre", type: "number", required: true, min: 0, max: 20 },
    { id: "date", label: "Date", type: "date", required: true },
    { id: "boolean", label: "Oui / Non", type: "boolean", required: true }
  ];
  const valid = { short: "Retour patient", single: "A", multi: ["A", "C"], scale: 1, number: 0, date: "2026-10-11", boolean: false };
  beforeEach(() => {
    database = new AppDatabase({ file: ":memory:" });
    app = createApp({ database });
    practitioner = `Bearer ${signUser(database.find("users", { id: "u-praticienne" })!)}`;
    patient = `Bearer ${signUser(database.find("users", { id: "u-camille" })!)}`;
    const user: User = { id: "other", email: "other@example.test", role: "praticien", displayName: "Autre", invitationStatus: "accepted" };
    database.insert("users", user);
    other = `Bearer ${signUser(user)}`;
  });
  afterEach(() => database.close());
  async function create() {
    const result = await request(app).post("/questionnaires").set("Authorization", practitioner).send({ title: "Suivi personnalisé", questions });
    expect(result.status).toBe(201);
    return result.body.questionnaire;
  }
  async function assign() {
    const q = await create();
    expect((await request(app).post(`/questionnaires/${q.id}/status`).set("Authorization", practitioner).send({ status: "published" })).status).toBe(200);
    const sent = await request(app).post(`/questionnaires/${q.id}/assign`).set("Authorization", practitioner).send({ clientIds: ["c-camille"], dueAt: "2026-10-30", note: "Avant notre séance" });
    expect(sent.status).toBe(201);
    return { q, assignment: sent.body.assignments[0] };
  }
  it("creates, edits, publishes, sends, receives and reviews all eight types with audit", async () => {
    const { q, assignment } = await assign();
    const visible = await request(app).get("/questionnaires").set("Authorization", patient);
    expect(visible.headers["cache-control"]).toContain("no-store");
    expect(visible.body.questionnaires).toContainEqual(expect.objectContaining({ id: q.id }));
    expect(visible.body.assignments).toContainEqual(expect.objectContaining({ note: "Avant notre séance" }));
    const sent = await request(app).post("/questionnaires/responses").set("Authorization", patient).send({ assignmentId: assignment.id, answers: valid });
    expect(sent.status).toBe(201);
    expect(sent.body.response.answers).toEqual(valid);
    expect((await request(app).post(`/questionnaires/assignments/${assignment.id}/review`).set("Authorization", practitioner)).status).toBe(200);
    expect(database.find("questionnaire_assignments", { id: assignment.id })?.status).toBe("reviewed");
    expect(database.list("audit_events").map((e) => e.action)).toEqual(expect.arrayContaining(["questionnaire.created", "questionnaire.published", "questionnaire.assigned", "questionnaire.submitted", "questionnaire.reviewed"]));
  });
  it("edits only drafts and preserves published questions when duplicating", async () => {
    const q = await create();
    const edited = await request(app).put(`/questionnaires/${q.id}`).set("Authorization", practitioner).send({ ...q, title: "Nouveau titre" });
    expect(edited.status).toBe(200);
    await request(app).post(`/questionnaires/${q.id}/status`).set("Authorization", practitioner).send({ status: "published" });
    expect((await request(app).put(`/questionnaires/${q.id}`).set("Authorization", practitioner).send({ ...q, questions: [] })).status).toBe(409);
    const copy = await request(app).post(`/questionnaires/${q.id}/duplicate`).set("Authorization", practitioner);
    expect(copy.status).toBe(201);
    expect(copy.body.questionnaire).toMatchObject({ version: 2, status: "draft", title: "Nouveau titre" });
    expect(copy.body.questionnaire.id).not.toBe(q.id);
    expect(database.find("questionnaires", { id: q.id })?.questions).toEqual(questions);
  });
  it("rejects malformed questionnaires, choices, scales and dates", async () => {
    for (const invalid of [
      [], [{ ...questions[0], label: " " }], [questions[0], questions[0]],
      [{ ...questions[2], options: ["A", "A"] }], [{ ...questions[2], options: undefined }],
      [{ ...questions[4], min: 10, max: 1 }], [{ ...questions[4], min: 1.5 }],
      [{ ...questions[3], max: 9 }]
    ]) {
      expect((await request(app).post("/questionnaires").set("Authorization", practitioner).send({ title: "Test", questions: invalid })).status).toBe(400);
    }
    const { q } = await assign();
    expect((await request(app).post(`/questionnaires/${q.id}/assign`).set("Authorization", practitioner).send({ clientIds: ["c-noa"], dueAt: "2026-02-30" })).status).toBe(400);
  });
  it("validates required answers, scalar types, ranges, selection counts and unknown questions on the server", async () => {
    const { assignment } = await assign();
    const missing = await request(app).post("/questionnaires/responses").set("Authorization", patient).send({ assignmentId: assignment.id, answers: {} });
    expect(missing.status).toBe(400);
    expect(missing.body.errors.scale).toMatch(/obligatoire/);
    for (const invalid of [
      { short: " " }, { short: "x".repeat(31) }, { single: "C" }, { multi: ["A", "A"] },
      { multi: ["D"] }, { multi: ["A", "B", "C"] }, { scale: 0 }, { scale: 11 }, { scale: 2.5 },
      { number: "2" }, { date: "2026-02-30" }, { boolean: "Non" }, { unknown: "injection" }
    ]) {
      expect((await request(app).post("/questionnaires/responses").set("Authorization", patient)
        .send({ assignmentId: assignment.id, answers: { ...valid, ...invalid } })).status).toBe(400);
    }
    expect(database.list("questionnaire_responses")).toHaveLength(0);
    expect(database.find("questionnaire_assignments", { id: assignment.id })?.status).toBe("todo");
  });
  it("isolates authors and patients, prevents draft sends, and rolls back unauthorized batch assignments", async () => {
    const q = await create();
    expect((await request(app).get("/questionnaires").set("Authorization", other)).body.questionnaires).not.toContainEqual(expect.objectContaining({ id: q.id }));
    expect((await request(app).get("/questionnaires").set("Authorization", patient)).body.questionnaires).not.toContainEqual(expect.objectContaining({ id: q.id }));
    for (const path of ["duplicate", "status", "assign"]) expect((await request(app).post(`/questionnaires/${q.id}/${path}`).set("Authorization", other).send({ status: "published", clientIds: ["c-camille"] })).status).toBe(404);
    expect((await request(app).post("/questionnaires").set("Authorization", patient).send({ title: "Interdit", questions })).status).toBe(403);
    expect((await request(app).post(`/questionnaires/${q.id}/assign`).set("Authorization", practitioner).send({ clientIds: ["c-camille"] })).status).toBe(409);
    await request(app).post(`/questionnaires/${q.id}/status`).set("Authorization", practitioner).send({ status: "published" });
    expect((await request(app).post(`/questionnaires/${q.id}/assign`).set("Authorization", practitioner).send({ clientIds: ["c-camille", "missing"] })).status).toBe(403);
    expect(database.list("questionnaire_assignments", { questionnaireId: q.id })).toHaveLength(0);
    expect((await request(app).post("/questionnaires/responses").set("Authorization", patient).send({ assignmentId: "unknown", answers: valid })).status).toBe(404);
  });
  it("sends to multiple patients atomically and prevents repeated pending sends and repeated submissions", async () => {
    const q = await create();
    await request(app).post(`/questionnaires/${q.id}/status`).set("Authorization", practitioner).send({ status: "published" });
    const sent = await request(app).post(`/questionnaires/${q.id}/assign`).set("Authorization", practitioner).send({ clientIds: ["c-camille", "c-noa"] });
    expect(sent.status).toBe(201);
    expect(sent.body.assignments).toHaveLength(2);
    expect((await request(app).post(`/questionnaires/${q.id}/assign`).set("Authorization", practitioner).send({ clientIds: ["c-camille"] })).status).toBe(409);
    const assignmentId = sent.body.assignments[0].id;
    const replies = await Promise.all([1, 2].map(() => request(app).post("/questionnaires/responses").set("Authorization", patient).send({ assignmentId, answers: valid })));
    expect(replies.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(database.list("questionnaire_responses", { assignmentId })).toHaveLength(1);
  });
  it("keeps existing patient assignments answerable after archival and blocks new sends", async () => {
    const { q, assignment } = await assign();
    await request(app).post(`/questionnaires/${q.id}/status`).set("Authorization", practitioner).send({ status: "archived" });
    expect((await request(app).post(`/questionnaires/${q.id}/assign`).set("Authorization", practitioner).send({ clientIds: ["c-noa"] })).status).toBe(409);
    expect((await request(app).post("/questionnaires/responses").set("Authorization", patient).send({ assignmentId: assignment.id, answers: valid })).status).toBe(201);
  });
});
