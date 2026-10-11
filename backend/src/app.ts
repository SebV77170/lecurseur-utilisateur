import cors from "cors";
import express from "express";
import helmet from "helmet";
import { nanoid } from "nanoid";
import { z } from "zod";
import { AccountStore } from "./accounts.js";
import { AppDatabase, type DatabaseOptions } from "./database.js";
import { inspectFile, maximumFileSize, ResourceStore } from "./resources.js";
import type { User } from "./types.js";
import { questionnaireRoutes } from "./questionnaires.js";
import { authentication, canAccessClient as checkClientAccess, requireRole, signUser, type AuthenticatedRequest } from "./auth.js";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(12).max(128)
});

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  displayName: z.string().trim().min(2).max(120),
  role: z.enum(["admin", "praticien", "client"]).default("client"),
  practitionerId: z.string().optional()
});

const invitationTokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });
const acceptInvitationSchema = invitationTokenSchema.extend({ password: z.string().min(12).max(128) });


const messageSchema = z.object({
  clientId: z.string(),
  body: z.string().min(1).max(4000),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        mimeType: z.string(),
        sizeLabel: z.string()
      })
    )
    .default([])
});

export function createApp(options: DatabaseOptions & { database?: AppDatabase } = {}) {
  const app = express();
  const database = options.database ?? new AppDatabase(options);
  const library = new ResourceStore(options.resourceDirectory ?? database.resourceDirectory, database);
  const accountStore = new AccountStore(database);
  const authenticate = authentication(database);
  const canAccessClient = (user: User, clientId: string) => checkClientAccess(database, user, clientId);
  const addAudit = database.addAudit.bind(database);
  app.locals.database = database;

  app.use(
    helmet({
      crossOriginResourcePolicy: false
    })
  );
  app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5180" }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "le-curseur-api" });
  });

  app.post("/auth/login", async (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Identifiants invalides." });
      return;
    }

    const user = database.find("users", { email: parsed.data.email });
    try {
      if (!user || !(await accountStore.verifyPassword(user, parsed.data.password))) {
        res.status(401).json({ message: "Connexion refusee." });
        return;
      }

      addAudit(user.id, "auth.login", user.id);
      res.setHeader("Cache-Control", "no-store");
      res.json({ token: signUser(user), user });
    } catch (error) { next(error); }
  });

  app.post("/auth/invitations/resolve", (req, res) => {
    const parsed = invitationTokenSchema.safeParse(req.body);
    const invitation = parsed.success ? accountStore.resolveInvitation(parsed.data.token) : null;
    if (!invitation) {
      res.status(410).json({ message: "Ce lien est expire ou a deja ete utilise. Demandez une nouvelle invitation." });
      return;
    }
    const { displayName, email, role } = invitation.user;
    res.setHeader("Cache-Control", "no-store");
    res.json({ user: { displayName, email, role }, expiresAt: invitation.expiresAt });
  });

  app.post("/auth/invitations/accept", async (req, res, next) => {
    const parsed = acceptInvitationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Choisissez un mot de passe de 12 a 128 caracteres." });
      return;
    }
    try {
      const user = await accountStore.acceptInvitation(parsed.data.token, parsed.data.password);
      if (!user) {
        res.status(410).json({ message: "Ce lien est expire ou a deja ete utilise. Demandez une nouvelle invitation." });
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({ user, token: signUser(user) });
    } catch (error) { next(error); }
  });

  app.get("/users", authenticate, requireRole("admin", "praticien"), (req: AuthenticatedRequest, res) => {
    res.json({ users: database.list("users").filter((user) => req.user!.role === "admin" || (user.clientId && canAccessClient(req.user!, user.clientId))) });
  });

  app.get("/me", authenticate, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user });
  });

  app.get("/clients", authenticate, requireRole("admin", "praticien"), (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      res.status(401).json({ message: "Authentification requise." });
      return;
    }

    const visibleClients =
      req.user.role === "admin" ? database.list("clients") : database.list("clients", { assignedPractitionerId: req.user.id });

    res.json({ clients: visibleClients });
  });

  const inviteUser: express.RequestHandler = (req: AuthenticatedRequest, res) => {
    const parsed = inviteSchema.safeParse(req.path === "/clients/invitations" ? { ...req.body, role: "client" } : req.body);
    if (!parsed.success || !req.user) {
      res.status(400).json({ message: "Invitation invalide." });
      return;
    }

    if (req.user.role !== "admin" && parsed.data.role !== "client") {
      res.status(403).json({ message: "Seul un administrateur peut creer ce profil." });
      return;
    }
    if (database.find("users", { email: parsed.data.email })) {
      res.status(409).json({ message: "Un compte existe deja avec cette adresse e-mail." });
      return;
    }
    const practitionerId = req.user.role === "praticien" ? req.user.id : parsed.data.practitionerId;
    if (parsed.data.role === "client" && !(practitionerId && database.find("users", { id: practitionerId, role: "praticien", invitationStatus: "accepted" }))) {
      res.status(400).json({ message: "Choisissez un praticien actif pour ce client." });
      return;
    }
    const clientId = parsed.data.role === "client" ? `c-${nanoid(8)}` : undefined;
    const userId = `u-${nanoid(8)}`;

    const client = {
      id: clientId!,
      displayName: parsed.data.displayName,
      email: parsed.data.email,
      status: "paused" as const,
      createdAt: new Date().toISOString(),
      tags: ["invitation en attente"],
      assignedPractitionerId: practitionerId!,
      careNotesSummary: "Fiche creee sans donnee de sante reelle.",
      rgpdConsent: {
        collectedAt: "",
        version: "v1-demo",
        scope: []
      }
    };

    const user: User = {
      id: userId,
      email: parsed.data.email,
      displayName: parsed.data.displayName,
      role: parsed.data.role,
      clientId,
      invitedBy: req.user.id,
      invitationStatus: "pending"
    };
    const invitation = accountStore.createInvitation(user, clientId ? client : undefined);
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ user, ...(clientId ? { client } : {}), invitation });
  };
  app.post("/users/invitations", authenticate, requireRole("admin", "praticien"), inviteUser);
  app.post("/clients/invitations", authenticate, requireRole("admin", "praticien"), inviteUser);

  app.post("/users/:userId/invitation", authenticate, requireRole("admin", "praticien"), (req: AuthenticatedRequest, res) => {
    const user = database.find("users", { id: req.params.userId });
    if (!user || (req.user!.role !== "admin" && (!user.clientId || !canAccessClient(req.user!, user.clientId)))) {
      res.status(404).json({ message: "Profil introuvable." });
      return;
    }
    if (user.invitationStatus !== "pending") {
      res.status(409).json({ message: "Ce compte est deja active." });
      return;
    }
    const invitation = accountStore.issueInvitation(user, req.user!.id);
    res.setHeader("Cache-Control", "no-store");
    res.json({ user, invitation });
  });

  app.get("/resources", authenticate, (req: AuthenticatedRequest, res) => {
    const { resources, assignments } = library;
    res.setHeader("Cache-Control", "no-store");
    if (!req.user) {
      res.status(401).json({ message: "Authentification requise." });
      return;
    }

    if (req.user.role === "client") {
      const allowedIds = assignments
        .filter((assignment) => assignment.clientId === req.user?.clientId)
        .map((assignment) => assignment.resourceId);
      res.json({
        resources: resources.filter((resource) => allowedIds.includes(resource.id)),
        assignments: assignments.filter((assignment) => assignment.clientId === req.user?.clientId)
      });
      return;
    }

    const visibleAssignments =
      req.user.role === "admin" ? assignments : assignments.filter((assignment) => canAccessClient(req.user!, assignment.clientId));

    res.json({ resources, assignments: visibleAssignments });
  });

  app.post("/resources", authenticate, requireRole("admin", "praticien"),
    express.raw({ type: "application/octet-stream", limit: maximumFileSize }),
    (req: AuthenticatedRequest, res, next) => {
      const parsed = z.object({
        title: z.string().trim().min(2).max(120), description: z.string().trim().max(1000).default(""),
        fileName: z.string().min(1).max(180).refine((name) => !/[\\/\x00-\x1f\x7f]/.test(name))
      }).safeParse(req.query);
      if (!parsed.success || !Buffer.isBuffer(req.body) || !req.body.length) {
        res.status(400).json({ message: "Choisissez un fichier non vide et un titre de 2 a 120 caracteres." });
        return;
      }
      const detected = inspectFile(parsed.data.fileName, req.body);
      if (!detected) {
        res.status(415).json({ message: "Format non pris en charge ou contenu invalide. Formats acceptes : PDF, MP3, WAV, M4A, OGG, PNG, JPEG et WebP." });
        return;
      }
      try {
        const resource = library.add({ ...parsed.data, ...detected }, req.body, req.user!.id);
        res.status(201).json({ resource });
      } catch (error) { next(error); }
    });

  app.get("/resources/:resourceId/file", authenticate, (req: AuthenticatedRequest, res) => {
    const resource = library.resources.find((item) => item.id === req.params.resourceId);
    const allowed = req.user!.role !== "client" || library.assignments.some((item) =>
      item.clientId === req.user!.clientId && item.resourceId === req.params.resourceId);
    if (!resource || !allowed) {
      res.status(404).json({ message: "Fichier introuvable ou non attribue." });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", resource.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="resource${resource.type === "pdf" ? ".pdf" : ""}"; filename*=UTF-8''${encodeURIComponent(resource.fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`);
    res.sendFile(library.filePath(resource), (error) => {
      if (!error) {
        try { addAudit(req.user!.id, "resource.downloaded", resource.id); }
        catch { console.error("L'audit du telechargement n'a pas pu etre enregistre."); }
      }
      else if (!res.headersSent) res.status(404).json({ message: "Fichier indisponible sur le serveur." });
    });
  });

  app.post("/resources/:resourceId/assign", authenticate, requireRole("admin", "praticien"), (req: AuthenticatedRequest, res) => {
    const schema = z.object({ clientId: z.string(), note: z.string().max(500).default("") });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      res.status(400).json({ message: "Attribution invalide." });
      return;
    }

    const resource = library.resources.find((item) => item.id === req.params.resourceId);
    const client = database.find("clients", { id: parsed.data.clientId });
    if (!resource || !client) {
      res.status(404).json({ message: "Ressource ou client introuvable." });
      return;
    }

    if (!canAccessClient(req.user, parsed.data.clientId)) {
      res.status(403).json({ message: "Droits insuffisants." });
      return;
    }

    const assignment = library.assign(resource.id, parsed.data.clientId, req.user.id, parsed.data.note);
    res.status(201).json({ assignment });
  });

  app.delete("/resources/:resourceId/assign/:clientId", authenticate, requireRole("admin", "praticien"), (req: AuthenticatedRequest, res) => {
    if (!canAccessClient(req.user!, req.params.clientId)) {
      res.status(403).json({ message: "Droits insuffisants." });
      return;
    }
    library.unassign(req.params.resourceId, req.params.clientId, req.user!.id);
    res.json({ success: true });
  });

  app.use("/questionnaires", questionnaireRoutes(database));

  app.get("/messages", authenticate, (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      res.status(401).json({ message: "Authentification requise." });
      return;
    }

    if (req.user.role === "client") {
      res.json({ messages: database.list("messages", { clientId: req.user.clientId }) });
      return;
    }

    res.json({
      messages: database.list("messages").filter((message) => req.user?.role === "admin" || canAccessClient(req.user!, message.clientId))
    });
  });

  app.post("/messages", authenticate, (req: AuthenticatedRequest, res) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success || !req.user || !canAccessClient(req.user, parsed.data.clientId)) {
      res.status(400).json({ message: "Message invalide." });
      return;
    }

    const message = {
      id: `m-${nanoid(8)}`,
      threadId: `t-${parsed.data.clientId}`,
      senderId: req.user.id,
      clientId: parsed.data.clientId,
      body: parsed.data.body,
      createdAt: new Date().toISOString(),
      attachments: parsed.data.attachments.map((attachment) => ({
        id: `att-${nanoid(8)}`,
        ...attachment
      }))
    };
    database.transaction(() => {
      database.insert("messages", message);
      addAudit(req.user!.id, "message.created", parsed.data.clientId);
    });
    res.status(201).json({ message });
  });

  app.get("/audit", authenticate, requireRole("admin"), (_req, res) => {
    res.json({ auditEvents: database.list("audit_events") });
  });

  app.get("/rgpd/export/:clientId", authenticate, (req: AuthenticatedRequest, res) => {
    const clientId = req.params.clientId;
    if (!req.user || !canAccessClient(req.user, clientId)) {
      res.status(403).json({ message: "Droits insuffisants." });
      return;
    }

    res.json({
      client: database.find("clients", { id: clientId }),
      resources: library.assignments.filter((assignment) => assignment.clientId === clientId),
      questionnaires: database.list("questionnaire_assignments", { clientId }),
      messages: database.list("messages", { clientId }),
      note: "Export de demonstration. A remplacer par un processus RGPD valide avant production."
    });
  });

  app.use((error: { type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(error.type === "entity.too.large" ? 413 : 500).json({
      message: error.type === "entity.too.large" ? "Fichier trop volumineux. La limite est de 20 Mo." : "L'operation n'a pas pu etre enregistree. Reessayez."
    });
  });

  return app;
}

