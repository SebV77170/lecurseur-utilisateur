import { Router } from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import { authentication, canAccessClient, requireRole, type AuthenticatedRequest } from "./auth.js";
import type { AppDatabase } from "./database.js";
import type { Answer, Questionnaire, User } from "./types.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((date) =>
  !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date);
const questionSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/).refine((id) => !["__proto__", "prototype", "constructor"].includes(id)),
  label: z.string().trim().min(1).max(500),
  type: z.enum(["text", "textarea", "choice", "multiple", "scale", "number", "date", "boolean"]),
  required: z.boolean(),
  helpText: z.string().trim().max(1000).optional(),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(50).optional(),
  min: z.number().finite().min(-1000000).max(1000000).optional(),
  max: z.number().finite().min(-1000000).max(1000000).optional(),
  maxLength: z.number().int().min(1).max(10000).optional()
}).superRefine((question, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (["choice", "multiple"].includes(question.type) && !question.options) fail("Ajoutez au moins deux choix.");
  if (question.options && new Set(question.options).size !== question.options.length) fail("Les choix doivent être distincts.");
  if (question.min !== undefined && question.max !== undefined && question.min > question.max) fail("Le minimum doit être inférieur au maximum.");
  if (question.type === "scale") {
    const min = question.min ?? 0, max = question.max ?? 10;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min >= max || max - min > 100) fail("L'échelle doit comporter 2 à 101 valeurs entières.");
  }
  if (question.type === "multiple" && [question.min, question.max].some((n) =>
    n !== undefined && (!Number.isInteger(n) || n < 0 || n > (question.options?.length ?? 0)))) fail("Les limites de sélection doivent correspondre au nombre de choix.");
});
const questionnaireSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(3000).default(""),
  sensitivity: z.enum(["standard", "health"]).default("health"),
  questions: z.array(questionSchema).min(1).max(100)
}).refine((data) => new Set(data.questions.map((q) => q.id)).size === data.questions.length, "Les identifiants des questions doivent être uniques.");
const answersSchema = z.record(z.union([z.string().max(10000), z.number().finite(), z.boolean(), z.array(z.string().max(200)).max(50)]));

export function validateAnswers(questionnaire: Questionnaire, answers: Record<string, Answer>) {
  const errors: Record<string, string> = {};
  const clean: Record<string, Answer> = {};
  if (Object.keys(answers).some((id) => !questionnaire.questions.some((q) => q.id === id))) errors._form = "Une question est inconnue.";
  for (const question of questionnaire.questions) {
    const value = answers[question.id];
    const empty = value === undefined || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length);
    if (empty) {
      if (question.required) errors[question.id] = "Cette question est obligatoire.";
      continue;
    }
    let valid = false;
    switch (question.type) {
      case "text": case "textarea":
        valid = typeof value === "string" && value.length <= (question.maxLength ?? 10000); break;
      case "choice":
        valid = typeof value === "string" && !!question.options?.includes(value); break;
      case "multiple":
        valid = Array.isArray(value) && value.every((v) => question.options?.includes(v)) &&
          new Set(value).size === value.length && value.length >= (question.min ?? 0) && value.length <= (question.max ?? 50); break;
      case "scale": case "number":
        valid = typeof value === "number" && Number.isFinite(value) &&
          (question.type !== "scale" || Number.isInteger(value)) &&
          value >= (question.min ?? (question.type === "scale" ? 0 : -Infinity)) &&
          value <= (question.max ?? (question.type === "scale" ? 10 : Infinity)); break;
      case "date": valid = dateSchema.safeParse(value).success; break;
      case "boolean": valid = typeof value === "boolean"; break;
    }
    if (!valid) errors[question.id] = "Vérifiez le format et les limites de cette réponse.";
    else clean[question.id] = typeof value === "string" ? value.trim() : value;
  }
  return { errors, answers: clean };
}

export function questionnaireRoutes(database: AppDatabase) {
  const router = Router();
  router.use(authentication(database), (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
  const manages = (user: User, q: Questionnaire) => user.role === "admin" ||
    (user.role === "praticien" && (!q.createdBy || q.createdBy === user.id));
  const getQuestionnaire = (req: AuthenticatedRequest) => {
    const q = database.find("questionnaires", { id: req.params.id });
    return q && manages(req.user!, q) ? q : undefined;
  };
  router.get("/", (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const assignments = database.list("questionnaire_assignments").filter((a) => canAccessClient(database, user, a.clientId));
    const ids = new Set(assignments.map((a) => a.questionnaireId));
    const assignmentIds = new Set(assignments.map((a) => a.id));
    res.json({
      questionnaires: database.list("questionnaires").filter((q) => user.role === "client" ? ids.has(q.id) : manages(user, q) || ids.has(q.id)),
      assignments,
      responses: database.list("questionnaire_responses").filter((r) => assignmentIds.has(r.assignmentId))
    });
  });
  router.post("/", requireRole("admin", "praticien"), (req: AuthenticatedRequest, res) => {
    const parsed = questionnaireSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ message: parsed.error.issues[0].message }); return; }
    const questionnaire: Questionnaire = { ...parsed.data, id: `q-${nanoid(12)}`, version: 1, status: "draft", createdBy: req.user!.id, createdAt: new Date().toISOString() };
    database.transaction(() => {
      database.insert("questionnaires", questionnaire);
      database.addAudit(req.user!.id, "questionnaire.created", questionnaire.id);
    });
    res.status(201).json({ questionnaire });
  });
  router.put("/:id", requireRole("admin", "praticien"), (req: AuthenticatedRequest, res) => {
    const q = getQuestionnaire(req);
    if (!q) { res.status(404).json({ message: "Questionnaire introuvable." }); return; }
    if (q.status !== "draft") { res.status(409).json({ message: "Dupliquez cette version pour modifier les questions." }); return; }
    const parsed = questionnaireSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ message: parsed.error.issues[0].message }); return; }
    const questionnaire = { ...q, ...parsed.data };
    database.transaction(() => {
      database.put("questionnaires", questionnaire);
      database.addAudit(req.user!.id, "questionnaire.updated", q.id);
    });
    res.json({ questionnaire });
  });
  router.post("/:id/duplicate", requireRole("admin", "praticien"), (req: AuthenticatedRequest, res) => {
    const q = getQuestionnaire(req);
    if (!q) { res.status(404).json({ message: "Questionnaire introuvable." }); return; }
    const questionnaire: Questionnaire = { ...q, id: `q-${nanoid(12)}`, version: q.version + 1, status: "draft", createdBy: req.user!.id, createdAt: new Date().toISOString() };
    database.transaction(() => {
      database.insert("questionnaires", questionnaire);
      database.addAudit(req.user!.id, "questionnaire.duplicated", questionnaire.id, { sourceId: q.id });
    });
    res.status(201).json({ questionnaire });
  });
  router.post("/:id/status", requireRole("admin", "praticien"), (req: AuthenticatedRequest, res) => {
    const q = getQuestionnaire(req);
    const parsed = z.object({ status: z.enum(["published", "archived"]) }).safeParse(req.body);
    if (!q) { res.status(404).json({ message: "Questionnaire introuvable." }); return; }
    if (!parsed.success) { res.status(400).json({ message: "Statut invalide." }); return; }
    if ((parsed.data.status === "published" && (q.status !== "draft" || !questionnaireSchema.safeParse(q).success)) || q.status === "archived") {
      res.status(409).json({ message: "Cette transition est impossible. Dupliquez le questionnaire si nécessaire." }); return;
    }
    const questionnaire = { ...q, status: parsed.data.status };
    database.transaction(() => {
      database.put("questionnaires", questionnaire);
      database.addAudit(req.user!.id, `questionnaire.${parsed.data.status}`, q.id);
    });
    res.json({ questionnaire });
  });
  router.post("/:id/assign", requireRole("admin", "praticien"), (req: AuthenticatedRequest, res) => {
    const q = getQuestionnaire(req);
    const parsed = z.object({
      clientIds: z.array(z.string()).min(1).max(200).refine((ids) => new Set(ids).size === ids.length),
      dueAt: z.union([z.literal(""), dateSchema]).default(""),
      note: z.string().trim().max(1000).default("")
    }).safeParse(req.body);
    if (!q) { res.status(404).json({ message: "Questionnaire introuvable." }); return; }
    if (q.status !== "published") { res.status(409).json({ message: "Publiez le questionnaire avant de l'envoyer." }); return; }
    if (!parsed.success) { res.status(400).json({ message: "Sélectionnez des patients et une échéance valide (facultative)." }); return; }
    if (parsed.data.clientIds.some((id) => !database.find("clients", { id }) || !canAccessClient(database, req.user!, id))) {
      res.status(403).json({ message: "Un patient est introuvable ou hors de votre suivi." }); return;
    }
    const assignments = database.transaction(() => {
      if (parsed.data.clientIds.some((clientId) => database.find("questionnaire_assignments", { clientId, questionnaireId: q.id, status: "todo" }))) return null;
      return parsed.data.clientIds.map((clientId) => {
        const assignment = { id: `qa-${nanoid(12)}`, questionnaireId: q.id, clientId, dueAt: parsed.data.dueAt,
          note: parsed.data.note, status: "todo" as const, assignedBy: req.user!.id, assignedAt: new Date().toISOString() };
        database.insert("questionnaire_assignments", assignment);
        database.addAudit(req.user!.id, "questionnaire.assigned", clientId, { assignmentId: assignment.id, questionnaireId: q.id });
        return assignment;
      });
    });
    if (!assignments) { res.status(409).json({ message: "Un patient sélectionné a déjà cette version à compléter." }); return; }
    res.status(201).json({ assignments });
  });
  router.post("/responses", requireRole("client"), (req: AuthenticatedRequest, res) => {
    const parsed = z.object({ assignmentId: z.string(), answers: answersSchema }).safeParse(req.body);
    if (!parsed.success || !req.user!.clientId) { res.status(400).json({ message: "Réponse invalide." }); return; }
    const assignment = database.find("questionnaire_assignments", { id: parsed.data.assignmentId, clientId: req.user!.clientId });
    if (!assignment) { res.status(404).json({ message: "Questionnaire introuvable." }); return; }
    const q = database.find("questionnaires", { id: assignment.questionnaireId })!;
    const validated = validateAnswers(q, parsed.data.answers);
    if (Object.keys(validated.errors).length) { res.status(400).json({ message: "Complétez les questions obligatoires et vérifiez vos réponses.", errors: validated.errors }); return; }
    const response = database.transaction(() => {
      const current = database.find("questionnaire_assignments", { id: assignment.id })!;
      if (current.status !== "todo" || database.find("questionnaire_responses", { assignmentId: assignment.id })) return null;
      const result = { id: `qr-${nanoid(12)}`, assignmentId: assignment.id, clientId: assignment.clientId,
        submittedAt: new Date().toISOString(), answers: validated.answers };
      database.insert("questionnaire_responses", result);
      database.put("questionnaire_assignments", { ...current, status: "submitted" });
      database.addAudit(req.user!.id, "questionnaire.submitted", assignment.clientId, { assignmentId: assignment.id });
      return result;
    });
    if (!response) { res.status(409).json({ message: "Vos réponses ont déjà été envoyées." }); return; }
    res.status(201).json({ response });
  });
  router.post("/assignments/:assignmentId/review", requireRole("admin", "praticien"), (req: AuthenticatedRequest, res) => {
    const assignment = database.find("questionnaire_assignments", { id: req.params.assignmentId });
    if (!assignment || !canAccessClient(database, req.user!, assignment.clientId)) { res.status(404).json({ message: "Réponse introuvable." }); return; }
    if (assignment.status !== "submitted") { res.status(409).json({ message: "Aucune nouvelle réponse à examiner." }); return; }
    database.transaction(() => {
      database.put("questionnaire_assignments", { ...assignment, status: "reviewed" });
      database.addAudit(req.user!.id, "questionnaire.reviewed", assignment.clientId, { assignmentId: assignment.id });
    });
    res.json({ success: true });
  });
  return router;
}
