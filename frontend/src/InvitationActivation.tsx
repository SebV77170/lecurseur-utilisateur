import { Activity, Eye, EyeOff, Lock } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api } from "./api";
import { roleLabels } from "./AccountsPanel";
import type { InvitationDetails, User } from "./types";

export function InvitationActivation({ token, onActivated, onCancel }: {
  token: string; onActivated: (session: { token: string; user: User }) => Promise<void>; onCancel: () => void;
}) {
  const [details, setDetails] = useState<InvitationDetails | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setDetails(null);
    api.resolveInvitation(token).then((result) => { if (active) setDetails(result); })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Invitation indisponible."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (password !== confirmation) { setError("Les mots de passe ne correspondent pas."); return; }
    if (password.length < 12 || password.length > 128) { setError("Choisissez un mot de passe de 12 a 128 caracteres."); return; }
    setBusy(true);
    try { await onActivated(await api.acceptInvitation(token, password)); }
    catch (err) { setError(err instanceof Error ? err.message : "Activation impossible."); }
    finally { setBusy(false); }
  }

  return <main className="login-screen">
    <form className="login-card activation-form" onSubmit={(event) => void submit(event)}>
      <div className="brand compact"><div className="mark"><Activity size={24} aria-hidden /></div><div><strong>Le Curseur</strong><span>Mon espace</span></div></div>
      <h1>Activer mon compte</h1>
      {loading ? <p role="status">Verification de votre invitation...</p> : null}
      {details ? <>
        <div className="activation-identity"><strong>{details.user.displayName}</strong><span>{details.user.email}</span><span className="badge">{roleLabels[details.user.role]}</span></div>
        <label>Mot de passe personnel
          <span className="password-field"><input type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={128} required autoComplete="new-password" aria-describedby="password-length" disabled={busy} />
            <button type="button" className="icon-button" aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"} title={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}</button>
          </span>
        </label>
        <small id="password-length" className="muted">12 a 128 caracteres.</small>
        <label>Confirmer le mot de passe<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={12} maxLength={128} required autoComplete="new-password" disabled={busy} /></label>
        <button type="submit" className="primary-button" disabled={busy}><Lock size={18} aria-hidden />{busy ? "Activation..." : "Activer mon compte"}</button>
      </> : null}
      {error ? <p role="alert" className="error">{error}</p> : null}
      <button type="button" className="text-button" onClick={onCancel} disabled={busy}>Retour a la connexion</button>
    </form>
  </main>;
}
