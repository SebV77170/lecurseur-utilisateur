import type {
  AuditEvent,
  ClientRecord,
  InvitationDetails,
  InvitationResult,
  Role,
  Message,
  Questionnaire,
  QuestionnaireAssignment,
  QuestionnaireResponse,
  Answer,
  Resource,
  ResourceAssignment,
  User
} from "./types";

const tokenKey = "le-curseur-token";

export function getStoredToken() {
  return localStorage.getItem(tokenKey);
}

export function storeToken(token: string) {
  localStorage.setItem(tokenKey, token);
}

export function clearToken() {
  localStorage.removeItem(tokenKey);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "Erreur reseau" }));
    throw new Error(body.message ?? "Erreur reseau");
  }

  return response.json() as Promise<T>;
}

export const api = {
  async login(email: string, password: string) {
    return request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  },
  me() {
    return request<{ user: User }>("/me");
  },
  clients() {
    return request<{ clients: ClientRecord[] }>("/clients");
  },
  users() {
    return request<{ users: User[] }>("/users");
  },
  inviteUser(profile: { email: string; displayName: string; role: Role; practitionerId?: string }) {
    return request<InvitationResult>("/users/invitations", {
      method: "POST",
      body: JSON.stringify(profile)
    });
  },
  renewInvitation(userId: string) {
    return request<InvitationResult>(`/users/${encodeURIComponent(userId)}/invitation`, { method: "POST" });
  },
  resolveInvitation(token: string) {
    return request<InvitationDetails>("/auth/invitations/resolve", {
      method: "POST", body: JSON.stringify({ token })
    });
  },
  acceptInvitation(token: string, password: string) {
    return request<{ token: string; user: User }>("/auth/invitations/accept", {
      method: "POST", body: JSON.stringify({ token, password })
    });
  },
  resources() {
    return request<{ resources: Resource[]; assignments: ResourceAssignment[] }>("/resources");
  },
  uploadResource(file: File, title: string, description: string) {
    const query = new URLSearchParams({ title, description, fileName: file.name });
    return request<{ resource: Resource }>(`/resources?${query}`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file
    });
  },
  assignResource(resourceId: string, clientId: string, note: string) {
    return request<{ assignment: ResourceAssignment }>(`/resources/${encodeURIComponent(resourceId)}/assign`, {
      method: "POST", body: JSON.stringify({ clientId, note })
    });
  },
  unassignResource(resourceId: string, clientId: string) {
    return request<{ success: boolean }>(`/resources/${encodeURIComponent(resourceId)}/assign/${encodeURIComponent(clientId)}`, { method: "DELETE" });
  },
  async resourceFile(resourceId: string) {
    const token = getStoredToken();
    const response = await fetch(`/api/resources/${encodeURIComponent(resourceId)}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store"
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: "Telechargement impossible." }));
      throw new Error(body.message ?? "Telechargement impossible.");
    }
    return response.blob();
  },
  questionnaires() {
    return request<{
      questionnaires: Questionnaire[];
      assignments: QuestionnaireAssignment[];
      responses: QuestionnaireResponse[];
    }>("/questionnaires");
  },
  saveQuestionnaire(questionnaire: Pick<Questionnaire, "title" | "description" | "sensitivity" | "questions">, id?: string) {
    return request<{ questionnaire: Questionnaire }>(id ? `/questionnaires/${encodeURIComponent(id)}` : "/questionnaires", {
      method: id ? "PUT" : "POST", body: JSON.stringify(questionnaire)
    });
  },
  questionnaireStatus(id: string, status: "published" | "archived") {
    return request<{ questionnaire: Questionnaire }>(`/questionnaires/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) });
  },
  duplicateQuestionnaire(id: string) {
    return request<{ questionnaire: Questionnaire }>(`/questionnaires/${encodeURIComponent(id)}/duplicate`, { method: "POST" });
  },
  assignQuestionnaire(id: string, clientIds: string[], dueAt: string, note: string) {
    return request<{ assignments: QuestionnaireAssignment[] }>(`/questionnaires/${encodeURIComponent(id)}/assign`, {
      method: "POST", body: JSON.stringify({ clientIds, dueAt, note })
    });
  },
  reviewQuestionnaire(id: string) {
    return request<{ success: boolean }>(`/questionnaires/assignments/${encodeURIComponent(id)}/review`, { method: "POST" });
  },
  submitQuestionnaire(assignmentId: string, answers: Record<string, Answer>) {
    return request<{ response: QuestionnaireResponse }>("/questionnaires/responses", {
      method: "POST",
      body: JSON.stringify({ assignmentId, answers })
    });
  },
  messages() {
    return request<{ messages: Message[] }>("/messages");
  },
  sendMessage(clientId: string, body: string) {
    return request<{ message: Message }>("/messages", {
      method: "POST",
      body: JSON.stringify({ clientId, body, attachments: [] })
    });
  },
  audit() {
    return request<{ auditEvents: AuditEvent[] }>("/audit");
  },
  exportRgpd(clientId: string) {
    return request<unknown>(`/rgpd/export/${clientId}`);
  }
};

