import { Check, Copy, ExternalLink, Link, Search, UserPlus } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { api } from "./api";
import type { InvitationResult, Role, User } from "./types";

export const roleLabels: Record<Role, string> = { admin: "Administrateur", praticien: "Praticien", client: "Client" };

export function AccountsPanel({ user, profiles, onRefresh }: {
  user: User; profiles: User[]; onRefresh: () => Promise<void>;
}) {
  const [role, setRole] = useState<Role>("client");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [practitionerId, setPractitionerId] = useState("");
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<InvitationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const practitioners = profiles.filter((profile) => profile.role === "praticien" && profile.invitationStatus === "accepted");
  const visibleProfiles = useMemo(() => profiles.filter((profile) =>
    `${profile.displayName} ${profile.email}`.toLocaleLowerCase("fr").includes(search.toLocaleLowerCase("fr"))
  ), [profiles, search]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setCopied(false); setResult(null);
    try {
      const created = await api.inviteUser({ displayName, email, role, practitionerId: practitionerId || undefined });
      setResult(created); setDisplayName(""); setEmail("");
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creation impossible.");
    } finally { setBusy(false); }
  }

  async function renew(profile: User) {
    setBusy(true); setError(""); setCopied(false); setResult(null);
    try {
      setResult(await api.renewInvitation(profile.id));
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invitation impossible.");
    } finally { setBusy(false); }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.invitation.url);
      setCopied(true);
    } catch { setError("Copie indisponible. Vous pouvez selectionner le lien ci-dessous."); }
  }

  return (
    <section className="accounts-section" id="profils" aria-labelledby="accounts-title">
      <div className="panel-heading">
        <div><p className="eyebrow">Acces prives</p><h2 id="accounts-title">{user.role === "admin" ? "Profils et invitations" : "Mes clients et invitations"}</h2></div>
        <span className="badge">{profiles.length} profil{profiles.length > 1 ? "s" : ""}</span>
      </div>
      <div className="accounts-layout">
        <div className="profiles-list">
          <label className="search-field"><Search size={18} aria-hidden /><span className="sr-only">Rechercher un profil</span>
            <input type="search" placeholder="Rechercher un profil" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          {visibleProfiles.length === 0 ? <p className="muted">Aucun profil trouve.</p> : null}
          {visibleProfiles.map((profile) => (
            <article className="profile-row" key={profile.id}>
              <div className="profile-identity"><strong>{profile.displayName}</strong><span className="muted">{profile.email}</span></div>
              <div className="profile-state"><span>{roleLabels[profile.role]}</span><span className={`badge ${profile.invitationStatus === "accepted" ? "active" : "paused"}`}>{profile.invitationStatus === "accepted" ? "Actif" : "A activer"}</span></div>
              {profile.invitationStatus === "pending" ? (
                <button type="button" className="icon-button" title={`Regenerer le lien de ${profile.displayName}`} aria-label={`Regenerer le lien de ${profile.displayName}`} disabled={busy} onClick={() => void renew(profile)}><Link size={18} aria-hidden /></button>
              ) : <span className="profile-action-space" />}
            </article>
          ))}
        </div>
        <div className="account-editor">
          <form className="inline-form" aria-label="Creation de profil" onSubmit={(event) => void create(event)}>
            <h3>Nouveau profil</h3>
            {user.role === "admin" ? <label>Type de profil
              <select value={role} onChange={(event) => setRole(event.target.value as Role)} disabled={busy}>
                <option value="client">Client</option><option value="praticien">Praticien</option><option value="admin">Administrateur</option>
              </select>
            </label> : null}
            <label>Nom complet<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" minLength={2} maxLength={120} required disabled={busy} /></label>
            <label>Adresse e-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required disabled={busy} /></label>
            {user.role === "admin" && role === "client" ? <label>Praticien referent
              <select value={practitionerId} onChange={(event) => setPractitionerId(event.target.value)} required disabled={busy}>
                <option value="">Choisir un praticien</option>
                {practitioners.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}
              </select>
            </label> : null}
            <button className="primary-button" type="submit" disabled={busy || (user.role === "admin" && role === "client" && practitioners.length === 0)}><UserPlus size={18} aria-hidden />{busy ? "En cours..." : "Creer le profil"}</button>
          </form>
          {error ? <p role="alert" className="error account-feedback">{error}</p> : null}
          {result ? <div className="invitation-result" role="status">
            <strong>Invitation pour {result.user.displayName}</strong>
            <p>A transmettre a {result.user.email}. Aucun e-mail n'a ete envoye.</p>
            <label>Lien d'activation<input aria-label="Lien d'activation" value={result.invitation.url} readOnly onFocus={(event) => event.target.select()} /></label>
            <div className="invitation-actions">
              <button type="button" className="small-button" onClick={() => void copy()}>{copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}{copied ? "Copie" : "Copier le lien"}</button>
              <a href={result.invitation.url} target="_blank" rel="noreferrer" className="icon-button" title="Ouvrir l'invitation" aria-label="Ouvrir l'invitation"><ExternalLink size={18} aria-hidden /></a>
            </div>
            <small>Valable jusqu'au {new Date(result.invitation.expiresAt).toLocaleString("fr-FR")}. Le destinataire choisira son mot de passe.</small>
          </div> : null}
        </div>
      </div>
    </section>
  );
}
