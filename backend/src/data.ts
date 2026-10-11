// Demo fixtures only. Runtime reads and writes go through AppDatabase.
import type {
  AuditEvent,
  ClientRecord,
  Message,
  Questionnaire,
  QuestionnaireAssignment,
  QuestionnaireResponse,
  User
} from "./types.js";

export const demoPassword = "DemoCurseur!2026";

const now = "2026-10-10T10:00:00.000Z";

export const users: User[] = [
  {
    id: "u-admin",
    email: "admin@lecurseur.local",
    displayName: "Administration Le Curseur",
    role: "admin",
    invitationStatus: "accepted"
  },
  {
    id: "u-praticienne",
    email: "praticienne@lecurseur.local",
    displayName: "Praticienne demo",
    role: "praticien",
    invitationStatus: "accepted"
  },
  {
    id: "u-camille",
    email: "camille.client@example.test",
    displayName: "Camille Martin",
    role: "client",
    clientId: "c-camille",
    invitedBy: "u-praticienne",
    invitationStatus: "accepted"
  },
  {
    id: "u-noa",
    email: "noa.client@example.test",
    displayName: "Noa Bernard",
    role: "client",
    clientId: "c-noa",
    invitedBy: "u-praticienne",
    invitationStatus: "pending"
  }
];

export const clients: ClientRecord[] = [
  {
    id: "c-camille",
    displayName: "Camille Martin",
    email: "camille.client@example.test",
    status: "active",
    createdAt: "2026-09-21T09:30:00.000Z",
    tags: ["suivi regulier", "ressources audio"],
    assignedPractitionerId: "u-praticienne",
    careNotesSummary: "Donnees fictives : preferences de rythme et de supports.",
    rgpdConsent: {
      collectedAt: "2026-09-21T09:35:00.000Z",
      version: "v1-demo",
      scope: ["messagerie", "questionnaires", "ressources"]
    }
  },
  {
    id: "c-noa",
    displayName: "Noa Bernard",
    email: "noa.client@example.test",
    status: "paused",
    createdAt: "2026-10-01T13:10:00.000Z",
    tags: ["invitation en attente"],
    assignedPractitionerId: "u-praticienne",
    careNotesSummary: "Donnees fictives : aucune information de sante reelle.",
    rgpdConsent: {
      collectedAt: "2026-10-01T13:15:00.000Z",
      version: "v1-demo",
      scope: ["invitation"]
    }
  }
];

export const questionnaires: Questionnaire[] = [
  {
    id: "q-pratique",
    title: "Retour de pratique hebdomadaire",
    version: 2,
    status: "published",
    sensitivity: "health",
    questions: [
      {
        id: "q1",
        label: "Comment s'est passee votre pratique cette semaine ?",
        type: "text",
        required: true
      },
      {
        id: "q2",
        label: "Niveau de confort ressenti",
        type: "scale",
        required: true
      },
      {
        id: "q3",
        label: "Souhaitez-vous aborder un point specifique ?",
        type: "text",
        required: false
      }
    ]
  },
  {
    id: "q-accueil",
    title: "Questionnaire d'accueil",
    version: 1,
    status: "draft",
    sensitivity: "health",
    questions: [
      {
        id: "q1",
        label: "Objectif principal de l'accompagnement",
        type: "text",
        required: true
      }
    ]
  }
];

export const questionnaireAssignments: QuestionnaireAssignment[] = [
  {
    id: "qa-camille-1",
    clientId: "c-camille",
    questionnaireId: "q-pratique",
    dueAt: "2026-10-14T20:00:00.000Z",
    status: "todo"
  }
];

export const responses: QuestionnaireResponse[] = [];

export const messages: Message[] = [
  {
    id: "m-1",
    threadId: "t-camille",
    senderId: "u-praticienne",
    clientId: "c-camille",
    body: "Bonjour Camille, voici votre espace de demonstration. N'ajoutez aucune vraie donnee sensible ici.",
    createdAt: "2026-10-08T15:00:00.000Z",
    attachments: []
  },
  {
    id: "m-2",
    threadId: "t-camille",
    senderId: "u-camille",
    clientId: "c-camille",
    body: "Merci, j'ai bien acces aux ressources fictives.",
    createdAt: "2026-10-08T15:08:00.000Z",
    attachments: [
      {
        id: "att-demo",
        name: "retour-demo.txt",
        mimeType: "text/plain",
        sizeLabel: "2 Ko"
      }
    ]
  }
];

export const auditEvents: AuditEvent[] = [
  {
    id: "audit-1",
    actorId: "u-praticienne",
    action: "resource.assigned",
    target: "c-camille",
    createdAt: now,
    metadata: { resourceId: "r-audio-1" }
  }
];


