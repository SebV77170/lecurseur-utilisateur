import {
  Activity,
  ClipboardList,
  FileText,
  Lock,
  LogOut,
  MessageSquare,
  Paperclip,
  ShieldCheck,
  UserPlus,
  Users
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api, clearToken, getStoredToken, storeToken } from "./api";
import { AccountsPanel } from "./AccountsPanel";
import { InvitationActivation } from "./InvitationActivation";
import { ResourcesPanel } from "./ResourcesPanel";
import { QuestionnairesPanel } from "./QuestionnairesPanel";
import type {
  AuditEvent,
  ClientRecord,
  Message,
  Questionnaire,
  QuestionnaireAssignment,
  QuestionnaireResponse,
  Resource,
  ResourceAssignment,
  User
} from "./types";

type AppData = {
  profiles: User[];
  clients: ClientRecord[];
  resources: Resource[];
  resourceAssignments: ResourceAssignment[];
  questionnaires: Questionnaire[];
  questionnaireAssignments: QuestionnaireAssignment[];
  questionnaireResponses: QuestionnaireResponse[];
  messages: Message[];
  auditEvents: AuditEvent[];
};

const emptyData: AppData = {
  profiles: [],
  clients: [],
  resources: [],
  resourceAssignments: [],
  questionnaires: [],
  questionnaireAssignments: [],
  questionnaireResponses: [],
  messages: [],
  auditEvents: []
};

const demoPassword = "DemoCurseur!2026";

export function App() {
  const [invitationToken, setInvitationToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("invitation"));
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<AppData>(emptyData);
  const [selectedClientId, setSelectedClientId] = useState("c-camille");
  const [status, setStatus] = useState("Prototype local avec donnees fictives.");
  const [isLoading, setIsLoading] = useState(Boolean(getStoredToken()));

  async function loadSession() {
    setIsLoading(true);
    try {
      const me = await api.me();
      setUser(me.user);
      await loadData(me.user);
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadData(activeUser: User) {
    const [resourcesResult, questionnairesResult, messagesResult] = await Promise.all([
      api.resources(),
      api.questionnaires(),
      api.messages()
    ]);

    const clientsResult = activeUser.role === "client" ? { clients: [] } : await api.clients();
    const auditResult = activeUser.role === "admin" ? await api.audit() : { auditEvents: [] };
    const profilesResult = activeUser.role === "client" ? { users: [] } : await api.users();

    setData({
      profiles: profilesResult.users,
      clients: clientsResult.clients,
      resources: resourcesResult.resources,
      resourceAssignments: resourcesResult.assignments,
      questionnaires: questionnairesResult.questionnaires,
      questionnaireAssignments: questionnairesResult.assignments,
      questionnaireResponses: questionnairesResult.responses,
      messages: messagesResult.messages,
      auditEvents: auditResult.auditEvents
    });

    setSelectedClientId((previous) => activeUser.clientId ?? (clientsResult.clients.some((client) => client.id === previous) ? previous : clientsResult.clients[0]?.id ?? ""));
  }

  useEffect(() => {
    if (getStoredToken() && !invitationToken) {
      void loadSession();
    }
  }, []);

  useEffect(() => {
    const updateInvitation = () => setInvitationToken(new URLSearchParams(window.location.hash.slice(1)).get("invitation"));
    window.addEventListener("hashchange", updateInvitation);
    return () => window.removeEventListener("hashchange", updateInvitation);
  }, []);

  function clearInvitation() {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setInvitationToken(null);
    setIsLoading(false);
  }

  async function handleActivated(session: { token: string; user: User }) {
    storeToken(session.token);
    setData(emptyData);
    setUser(session.user);
    clearInvitation();
    setIsLoading(true);
    try {
      await loadData(session.user);
      setStatus("Votre compte est active.");
    } catch {
      setStatus("Compte active. Le chargement de votre espace a echoue : actualisez la page.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLogin(email: string, password: string) {
    setStatus("Connexion en cours...");
    const result = await api.login(email, password);
    storeToken(result.token);
    setUser(result.user);
    await loadData(result.user);
    setStatus("Session ouverte.");
  }

  function handleLogout() {
    clearToken();
    setUser(null);
    setData(emptyData);
    setStatus("Session fermee.");
  }

  if (invitationToken) {
    return <InvitationActivation key={invitationToken} token={invitationToken} onActivated={handleActivated} onCancel={() => { handleLogout(); clearInvitation(); }} />;
  }

  if (isLoading) {
    return <Splash />;
  }

  if (!user) {
    return <Login onLogin={handleLogin} status={status} />;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">
            <Activity size={24} aria-hidden />
          </div>
          <div>
            <strong>Le Curseur</strong>
            <span>Mon espace</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Sections">
          {user.role !== "client" ? <a href="#profils"><UserPlus size={18} aria-hidden /> Profils et invitations</a> : null}
          {user.role !== "client" ? (
          <a href="#clients">
            <Users size={18} aria-hidden /> Clients
          </a>
          ) : null}
          <a href="#ressources">
            <FileText size={18} aria-hidden /> Ressources
          </a>
          <a href="#questionnaires"><ClipboardList size={18} aria-hidden /> Questionnaires</a>
          <a href="#messagerie">
            <MessageSquare size={18} aria-hidden /> Messagerie
          </a>
          <a href="#securite">
            <ShieldCheck size={18} aria-hidden /> Securite
          </a>
        </nav>
        <button className="ghost-button" type="button" onClick={handleLogout}>
          <LogOut size={18} aria-hidden /> Deconnexion
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Prototype V1</p>
            <h1>Mon espace securise</h1>
          </div>
          <div className="session-pill">
            <Lock size={16} aria-hidden />
            {user.displayName} · {user.role}
          </div>
        </header>

        <div className="notice">
          <ShieldCheck size={20} aria-hidden />
          <p>
            Fiches de demonstration fictives ; les fichiers importes sont reels. La conformite RGPD/HDS, le choix d'hebergement et l'audit securite doivent etre
            valides avant toute production.
          </p>
        </div>

        <DashboardSummary data={data} user={user} />
        <p className="availability-legend">En gris : fonctionnalités à venir.</p>

        {user.role !== "client" ? <AccountsPanel user={user} profiles={data.profiles} onRefresh={() => loadData(user)} /> : null}

        {user.role !== "client" ? (
          <ClientAdmin
            clients={data.clients}
            selectedClientId={selectedClientId}
            onSelectClient={setSelectedClientId}
          />
        ) : null}

        <ResourcesPanel user={user} resources={data.resources} assignments={data.resourceAssignments} clients={data.clients} selectedClientId={selectedClientId} onRefresh={() => loadData(user)} />
        <QuestionnairesPanel
          user={user} clients={data.clients} selectedClientId={selectedClientId} responses={data.questionnaireResponses} onRefresh={() => loadData(user)}
          questionnaires={data.questionnaires}
          assignments={data.questionnaireAssignments}
        />
        <MessagesPanel user={user} messages={data.messages} selectedClientId={selectedClientId} onRefresh={() => loadData(user)} />
        <SecurityPanel user={user} auditEvents={data.auditEvents} />

        <footer className="statusbar">{status}</footer>
      </section>
    </main>
  );
}

function Splash() {
  return (
    <div className="login-screen">
      <div className="login-card">
        <Activity size={32} aria-hidden />
        <h1>Chargement de l'espace...</h1>
      </div>
    </div>
  );
}

function Login({ onLogin, status }: { onLogin: (email: string, password: string) => Promise<void>; status: string }) {
  const [email, setEmail] = useState("praticienne@lecurseur.local");
  const [password, setPassword] = useState(demoPassword);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await onLogin(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion impossible.");
    }
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="brand compact">
          <div className="mark">
            <Activity size={24} aria-hidden />
          </div>
          <div>
            <strong>Le Curseur</strong>
            <span>Mon espace</span>
          </div>
        </div>
        <h1>Connexion privee</h1>
        <p className="muted">Acces sur invitation. Prototype alimente uniquement par des donnees fictives.</p>
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" />
        </label>
        <label>
          Mot de passe
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
          />
        </label>
        <button className="primary-button" type="submit">
          <Lock size={18} aria-hidden /> Se connecter
        </button>
        {error ? <p className="error">{error}</p> : <p className="muted">{status}</p>}
        <div className="demo-logins">
          <button type="button" onClick={() => setEmail("admin@lecurseur.local")}>Admin</button>
          <button type="button" onClick={() => setEmail("praticienne@lecurseur.local")}>Praticien</button>
          <button type="button" onClick={() => setEmail("camille.client@example.test")}>Client</button>
        </div>
      </form>
    </main>
  );
}

function DashboardSummary({ data, user }: { data: AppData; user: User }) {
  const stats = [
    { label: "Clients", value: user.role === "client" ? 1 : data.clients.length, icon: Users },
    { label: "Ressources", value: data.resources.length, icon: FileText },
    { label: "Questionnaires", value: data.questionnaireAssignments.length, icon: ClipboardList },
    { label: "Messages", value: data.messages.length, icon: MessageSquare }
  ];

  return (
    <section className="summary-grid" aria-label="Synthese">
      {stats.map((stat) => (
        <article className="stat-card" key={stat.label}>
          <stat.icon size={20} aria-hidden />
          <span>{stat.label}</span>
          <strong>{stat.value}</strong>
        </article>
      ))}
    </section>
  );
}

function ClientAdmin({
  clients,
  selectedClientId,
  onSelectClient
}: {
  clients: ClientRecord[];
  selectedClientId: string;
  onSelectClient: (clientId: string) => void;
}) {
  return (
    <section className="panel" id="clients">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Administration</p>
          <h2>Fiches clients</h2>
        </div>
        <UserPlus size={22} aria-hidden />
      </div>
        <div className="table-list">
          {clients.map((client) => (
            <button
              type="button"
              className={client.id === selectedClientId ? "row selected" : "row"}
              key={client.id}
              onClick={() => onSelectClient(client.id)}
            >
              <span>
                <strong>{client.displayName}</strong>
                <small>{client.email}</small>
              </span>
              <span className={`badge ${client.status}`}>{client.status}</span>
            </button>
          ))}
        </div>
    </section>
  );
}

function MessagesPanel({
  user,
  messages,
  selectedClientId,
  onRefresh
}: {
  user: User;
  messages: Message[];
  selectedClientId: string;
  onRefresh: () => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const visibleMessages = messages.filter((message) => message.clientId === (user.clientId ?? selectedClientId));

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) {
      return;
    }

    await api.sendMessage(user.clientId ?? selectedClientId, body);
    setBody("");
    await onRefresh();
  }

  return (
    <section className="panel" id="messagerie">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Echanges prives</p>
          <h2>Messagerie et pieces jointes</h2>
        </div>
        <MessageSquare size={22} aria-hidden />
      </div>
      <div className="message-list">
        {visibleMessages.map((message) => (
          <article className={message.senderId === user.id ? "message mine" : "message"} key={message.id}>
            <p>{message.body}</p>
            <small>{new Date(message.createdAt).toLocaleString("fr-FR")}</small>
            {message.attachments.length ? <span className="attachment unavailable"><Paperclip size={14} aria-hidden />{message.attachments[0].name} · Exemple, fichier indisponible</span> : null}
          </article>
        ))}
      </div>
      <form className="message-form" onSubmit={send}>
        <input value={body} onChange={(event) => setBody(event.target.value)} placeholder="Message de demonstration" />
        <button className="primary-button" type="submit">
          Envoyer
        </button>
      </form>
      <div className="attachment-pending">
        <button className="small-button" type="button" disabled title="Envoi de pieces jointes a venir"><Paperclip size={16} aria-hidden /> Pièces jointes · À venir</button>
      </div>
    </section>
  );
}

function SecurityPanel({
  user,
  auditEvents
}: {
  user: User;
  auditEvents: AuditEvent[];
}) {
  return (
    <section className="panel" id="securite">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Controle</p>
          <h2>Securite, audit et RGPD</h2>
        </div>
        <ShieldCheck size={22} aria-hidden />
      </div>
      <div className="security-grid">
        <article>
          <h3>Mesures V1 prototype</h3>
          <ul>
            <li>Acces par invitation et roles separes.</li>
            <li>Routes API protegees par jeton signe.</li>
            <li>Journal d'audit des actions sensibles.</li>
          </ul>
          <div className="unavailable pending-feature">
            <button className="small-button" type="button" disabled title="Telechargement de l'export RGPD a venir">Export RGPD · À venir</button>
            <p>Le téléchargement de vos données n'est pas encore disponible.</p>
          </div>
        </article>
        <article className={user.role === "admin" ? undefined : "unavailable"}>
          <h3>Audit</h3>
          {user.role === "admin" ? (
            <div className="audit-list">
              {auditEvents.map((event) => (
                <p key={event.id}>
                  <strong>{event.action}</strong>
                  <span>{event.target}</span>
                </p>
              ))}
            </div>
          ) : (
            <p className="muted">Reserve au role admin.</p>
          )}
        </article>
      </div>
    </section>
  );
}

