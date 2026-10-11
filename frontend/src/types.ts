export type Role = "admin" | "praticien" | "client";

export type User = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  clientId?: string;
  invitationStatus: "pending" | "accepted";
};

export type Invitation = { url: string; expiresAt: string };
export type InvitationResult = { user: User; client?: ClientRecord; invitation: Invitation };
export type InvitationDetails = {
  user: Pick<User, "displayName" | "email" | "role">;
  expiresAt: string;
};

export type ClientRecord = {
  id: string;
  displayName: string;
  email: string;
  status: "active" | "paused" | "archived";
  createdAt: string;
  tags: string[];
  careNotesSummary: string;
  rgpdConsent: {
    collectedAt: string;
    version: string;
    scope: string[];
  };
};

export type Resource = {
  id: string;
  title: string;
  type: "pdf" | "audio" | "image";
  description: string;
  url: string;
  uploadedAt: string;
  sensitivity: "standard" | "sensitive";
  fileName: string;
  mimeType: string;
  size: number;
};

export type ResourceAssignment = {
  id: string;
  clientId: string;
  resourceId: string;
  assignedAt: string;
  note: string;
};

export type Answer = string | number | boolean | string[];
export type Question = {
  id: string;
  label: string;
  type: "text" | "textarea" | "choice" | "multiple" | "scale" | "number" | "date" | "boolean";
  required: boolean;
  helpText?: string;
  options?: string[];
  min?: number;
  max?: number;
  maxLength?: number;
};
export type Questionnaire = {
  id: string;
  title: string;
  description?: string;
  createdBy?: string;
  createdAt?: string;
  version: number;
  status: "draft" | "published" | "archived";
  sensitivity: "standard" | "health";
  questions: Question[];
};
export type QuestionnaireAssignment = {
  id: string;
  clientId: string;
  questionnaireId: string;
  dueAt: string;
  note?: string;
  assignedBy?: string;
  assignedAt?: string;
  status: "todo" | "submitted" | "reviewed";
};
export type QuestionnaireResponse = {
  id: string;
  assignmentId: string;
  clientId: string;
  submittedAt: string;
  answers: Record<string, Answer>;
};

export type Message = {
  id: string;
  threadId: string;
  senderId: string;
  clientId: string;
  body: string;
  createdAt: string;
  attachments: Array<{
    id: string;
    name: string;
    mimeType: string;
    sizeLabel: string;
  }>;
};

export type AuditEvent = {
  id: string;
  actorId: string;
  action: string;
  target: string;
  createdAt: string;
  metadata: Record<string, string>;
};

