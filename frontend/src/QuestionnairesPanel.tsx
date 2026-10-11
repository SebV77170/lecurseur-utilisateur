import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, ClipboardList, Copy, Plus, Trash2 } from "lucide-react";
import { api } from "./api";
import type { Answer, ClientRecord, Question, Questionnaire, QuestionnaireAssignment, QuestionnaireResponse, User } from "./types";

const types: Record<Question["type"], string> = {
  text: "Texte court", textarea: "Texte long", choice: "Choix unique",
  multiple: "Choix multiples", scale: "Échelle", number: "Nombre", date: "Date", boolean: "Oui / Non"
};
const statuses = { draft: "Brouillon", published: "Publié", archived: "Archivé", todo: "À compléter", submitted: "Répondu", reviewed: "Examiné" };
const newQuestion = (): Question => ({ id: crypto.randomUUID(), label: "", type: "text", required: false });
const blank = (): Questionnaire => ({ id: "", title: "", description: "", status: "draft", version: 1, sensitivity: "health", questions: [newQuestion()] });
const message = (error: unknown) => error instanceof Error ? error.message : "L'opération a échoué. Réessayez.";
function formatAnswer(value: Answer | undefined) {
  return value === undefined ? "Sans réponse" : Array.isArray(value) ? value.join(", ") : typeof value === "boolean" ? (value ? "Oui" : "Non") : String(value);
}

type Props = {
  user: User; questionnaires: Questionnaire[]; assignments: QuestionnaireAssignment[];
  responses: QuestionnaireResponse[]; clients: ClientRecord[]; selectedClientId: string;
  onRefresh: () => Promise<void>;
};

export function QuestionnairesPanel({ user, questionnaires, assignments, responses, clients, selectedClientId, onRefresh }: Props) {
  const [editor, setEditor] = useState<Questionnaire | null>(null);
  const [preview, setPreview] = useState<Questionnaire | null>(null);
  const [sendingId, setSendingId] = useState("");
  const [openAssignment, setOpenAssignment] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const practitioner = user.role !== "client";
  const visibleAssignments = assignments.filter((a) => !practitioner || !selectedClientId || a.clientId === selectedClientId);
  async function action(work: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setFeedback("");
    try { await work(); await onRefresh(); setFeedback(success); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  return (
    <section className="panel questionnaire-panel" id="questionnaires" aria-labelledby="questionnaires-title">
      <div className="panel-heading">
        <div><p className="eyebrow">{practitioner ? "Création et suivi" : "Votre suivi"}</p><h2 id="questionnaires-title">Questionnaires</h2></div>
        {practitioner ? <button type="button" className="primary-button" disabled={busy || !!editor} onClick={() => { setEditor(blank()); setPreview(null); }}><Plus size={18} aria-hidden /> Créer un questionnaire</button> : <ClipboardList aria-hidden />}
      </div>
      <p className="muted">{practitioner ? "Préparez vos questions, publiez le questionnaire puis envoyez-le dans l’espace privé de vos patients." : "Complétez les questionnaires transmis par votre praticien. Les questions marquées d’un * sont obligatoires."}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {feedback && <p className="resource-feedback" role="status">{feedback}</p>}
      {editor && <QuestionnaireEditor key={editor.id || "new"} initial={editor} onCancel={() => setEditor(null)} onPreview={setPreview} onSaved={async () => { setEditor(null); await onRefresh(); setFeedback("Brouillon enregistré. Vous pouvez maintenant le publier."); }} />}
      {preview && <div className="questionnaire-detail" role="region" aria-label="Aperçu du questionnaire">
        <div className="panel-heading"><h3>Aperçu patient</h3><button type="button" className="small-button" onClick={() => setPreview(null)}>Fermer l’aperçu</button></div>
        <ResponseForm key={preview.id + JSON.stringify(preview.questions)} questionnaire={preview} preview />
      </div>}
      {practitioner && <>
        <label className="questionnaire-search">Rechercher un questionnaire<input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
        <div className="questionnaire-library">
          {questionnaires.filter((q) => q.title.toLowerCase().includes(filter.toLowerCase())).map((q) => {
            const canManage = user.role === "admin" || !q.createdBy || q.createdBy === user.id;
            return <article className="questionnaire-card" key={q.id}>
              <div className="panel-heading"><div><h3>{q.title}</h3><small>Version {q.version} · {q.questions.length} question{q.questions.length > 1 ? "s" : ""}</small></div><span className={`badge ${q.status}`}>{statuses[q.status]}</span></div>
              {q.description && <p className="questionnaire-copy">{q.description}</p>}
              <div className="resource-actions">
                <button type="button" className="small-button" onClick={() => setPreview(q)}>Aperçu</button>
                {canManage && <>
                  {q.status === "draft" && <><button type="button" className="small-button" disabled={busy || !!editor} onClick={() => setEditor(q)}>Modifier</button>
                    <button type="button" className="primary-button" disabled={busy || !!editor} onClick={() => void action(() => api.questionnaireStatus(q.id, "published"), "Questionnaire publié. Vous pouvez l’envoyer aux patients.")}>Publier</button></>}
                  <button type="button" className="small-button" disabled={busy || !!editor} onClick={() => void action(async () => { const result = await api.duplicateQuestionnaire(q.id); setEditor(result.questionnaire); }, "Nouvelle version créée en brouillon.")}><Copy size={16} aria-hidden /> Dupliquer</button>
                  {q.status === "published" && <button type="button" className="primary-button" disabled={busy} onClick={() => setSendingId(sendingId === q.id ? "" : q.id)}>Envoyer aux patients</button>}
                  {q.status !== "archived" && <button type="button" className="text-button" disabled={busy || !!editor} onClick={() => void action(() => api.questionnaireStatus(q.id, "archived"), "Questionnaire archivé. Les envois et réponses restent consultables.")}>Archiver</button>}
                </>}
              </div>
              {q.status === "published" && <p className="muted">Pour modifier les questions, dupliquez cette version.</p>}
              {sendingId === q.id && <AssignmentForm questionnaire={q} clients={clients} assignments={assignments} selectedClientId={selectedClientId} onCancel={() => setSendingId("")} onSent={async () => { setSendingId(""); await onRefresh(); setFeedback("Questionnaire transmis : il est disponible dans l’espace des patients sélectionnés."); }} />}
            </article>;
          })}
          {!questionnaires.length && <p className="resource-empty">Créez votre premier questionnaire pour commencer.</p>}
        </div>
      </>}
      <div className="panel-heading questionnaire-followup"><div><h3>{practitioner ? "Envois et réponses" : "Mes questionnaires"}</h3>
        {practitioner && <p className="muted">{clients.find((c) => c.id === selectedClientId)?.displayName ?? "Tous les patients"} · {visibleAssignments.filter((a) => a.status === "todo").length} à compléter</p>}</div>
        <button type="button" className="small-button" disabled={busy} onClick={() => void action(async () => {}, "Questionnaires actualisés.")}>Actualiser</button>
      </div>
      {!visibleAssignments.length && <p className="resource-empty">{practitioner ? "Aucun questionnaire transmis à ce patient." : "Votre praticien ne vous a pas encore envoyé de questionnaire."}</p>}
      <div className="table-list">{visibleAssignments.map((assignment) => {
        const q = questionnaires.find((item) => item.id === assignment.questionnaireId);
        const response = responses.find((r) => r.assignmentId === assignment.id);
        if (!q) return null;
        return <article className="questionnaire-card" key={assignment.id}>
          <div className="row static"><span><strong>{q.title}</strong><small>Version {q.version} · {assignment.dueAt ? `Échéance : ${new Date(assignment.dueAt).toLocaleDateString("fr-FR")}` : "Sans échéance"}{assignment.dueAt && assignment.status === "todo" && assignment.dueAt.slice(0, 10) < new Date().toLocaleDateString("sv-SE") ? " · En retard" : ""}</small></span><span className={`badge ${assignment.status}`}>{statuses[assignment.status]}</span>
            {(!practitioner || response) && <button className="small-button" type="button" onClick={() => setOpenAssignment(openAssignment === assignment.id ? "" : assignment.id)}>{openAssignment === assignment.id ? "Fermer" : response ? "Voir les réponses" : "Répondre"}</button>}
          </div>
          {assignment.note && <p className="resource-note questionnaire-copy">{assignment.note}</p>}
          {openAssignment === assignment.id && (response ? <div className="questionnaire-detail">
            <p className="muted">Réponses envoyées le {new Date(response.submittedAt).toLocaleString("fr-FR")}</p>
            <dl className="questionnaire-answers">{q.questions.map((question) => <div key={question.id}><dt>{question.label}</dt><dd>{formatAnswer(response.answers[question.id])}</dd></div>)}</dl>
            {practitioner && assignment.status === "submitted" && <button type="button" className="primary-button" disabled={busy} onClick={() => void action(() => api.reviewQuestionnaire(assignment.id), "Réponses marquées comme examinées.")}>Marquer comme examiné</button>}
          </div> : <ResponseForm key={assignment.id} questionnaire={q} onSubmit={async (answers) => { await api.submitQuestionnaire(assignment.id, answers); await onRefresh(); setFeedback("Vos réponses ont bien été transmises à votre praticien."); }} />)}
        </article>;
      })}</div>
    </section>
  );
}

function QuestionnaireEditor({ initial, onCancel, onPreview, onSaved }: {
  initial: Questionnaire; onCancel: () => void; onPreview: (q: Questionnaire) => void; onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function updateQuestion(index: number, change: Partial<Question>) {
    setDraft({ ...draft, questions: draft.questions.map((q, i) => i === index ? { ...q, ...change } : q) });
  }
  function move(index: number, direction: number) {
    const questions = [...draft.questions];
    [questions[index], questions[index + direction]] = [questions[index + direction], questions[index]];
    setDraft({ ...draft, questions });
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try { await api.saveQuestionnaire(draft, draft.id || undefined); await onSaved(); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  return <form className="questionnaire-editor" onSubmit={save} aria-label="Éditeur de questionnaire">
    <fieldset disabled={busy} className="questionnaire-fieldset">
      <div className="panel-heading"><h3>{draft.id ? "Modifier le brouillon" : "Nouveau questionnaire"}</h3><span className="badge">Version {draft.version} · Brouillon</span></div>
      <label>Titre du questionnaire<input required minLength={2} maxLength={160} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
      <label>Introduction / consignes<textarea rows={3} maxLength={3000} value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
      <label>Nature du questionnaire<select value={draft.sensitivity} onChange={(e) => setDraft({ ...draft, sensitivity: e.target.value as Questionnaire["sensitivity"] })}><option value="health">Suivi de santé</option><option value="standard">Standard</option></select></label>
      {draft.questions.map((question, index) => <fieldset key={question.id} className="question-editor">
        <legend>Question {index + 1}</legend>
        <div className="resource-actions">
          <button type="button" className="icon-button" aria-label={`Monter la question ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
          <button type="button" className="icon-button" aria-label={`Descendre la question ${index + 1}`} disabled={index === draft.questions.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
          <button type="button" className="icon-button" aria-label={`Dupliquer la question ${index + 1}`} disabled={draft.questions.length >= 100} onClick={() => setDraft({ ...draft, questions: [...draft.questions.slice(0, index + 1), { ...question, id: crypto.randomUUID() }, ...draft.questions.slice(index + 1)] })}><Copy size={16} /></button>
          <button type="button" className="icon-button" aria-label={`Supprimer la question ${index + 1}`} disabled={draft.questions.length === 1} onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, i) => i !== index) })}><Trash2 size={16} /></button>
        </div>
        <label>Intitulé de la question {index + 1}<input required maxLength={500} value={question.label} onChange={(e) => updateQuestion(index, { label: e.target.value })} /></label>
        <div className="questionnaire-columns"><label>Type de question {index + 1}<select value={question.type} onChange={(e) => {
          const type = e.target.value as Question["type"];
          updateQuestion(index, { type, options: ["choice", "multiple"].includes(type) ? ["Option 1", "Option 2"] : undefined, min: type === "scale" ? 1 : undefined, max: type === "scale" ? 10 : undefined, maxLength: undefined });
        }}>{Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="check-label"><input type="checkbox" checked={question.required} onChange={(e) => updateQuestion(index, { required: e.target.checked })} /> Question obligatoire</label></div>
        <label>Aide pour la question {index + 1}<input maxLength={1000} value={question.helpText ?? ""} onChange={(e) => updateQuestion(index, { helpText: e.target.value })} /></label>
        {["choice", "multiple"].includes(question.type) && <div className="questionnaire-options">
          {(question.options ?? []).map((option, optionIndex) => <div className="option-editor" key={optionIndex}><label>Choix {optionIndex + 1} de la question {index + 1}<input required maxLength={200} value={option} onChange={(e) => updateQuestion(index, { options: question.options!.map((v, i) => i === optionIndex ? e.target.value : v) })} /></label>
            <button type="button" className="icon-button" disabled={question.options!.length <= 2} aria-label={`Retirer le choix ${optionIndex + 1} de la question ${index + 1}`} onClick={() => updateQuestion(index, { options: question.options!.filter((_, i) => i !== optionIndex) })}><Trash2 size={16} /></button></div>)}
          <button type="button" className="small-button" disabled={(question.options?.length ?? 0) >= 50} onClick={() => updateQuestion(index, { options: [...(question.options ?? []), ""] })}>Ajouter un choix</button>
        </div>}
        {["scale", "number", "multiple"].includes(question.type) && <div className="questionnaire-columns">
          <label>{question.type === "multiple" ? "Minimum de choix" : "Valeur minimale"}<input type="number" min={question.type === "multiple" ? 0 : -1000000} max={1000000} step={question.type === "number" ? "any" : 1} value={question.min ?? ""} onChange={(e) => updateQuestion(index, { min: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
          <label>{question.type === "multiple" ? "Maximum de choix" : "Valeur maximale"}<input type="number" min={question.min ?? -1000000} max={1000000} step={question.type === "number" ? "any" : 1} value={question.max ?? ""} onChange={(e) => updateQuestion(index, { max: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
        </div>}
        {["text", "textarea"].includes(question.type) && <label>Longueur maximale (caractères)<input type="number" min={1} max={10000} value={question.maxLength ?? ""} placeholder="10000" onChange={(e) => updateQuestion(index, { maxLength: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>}
      </fieldset>)}
      <div className="resource-actions">
        <button type="button" className="small-button" disabled={draft.questions.length >= 100} onClick={() => setDraft({ ...draft, questions: [...draft.questions, newQuestion()] })}><Plus size={16} /> Ajouter une question</button>
        <button type="button" className="small-button" onClick={() => onPreview(draft)}>Aperçu patient</button>
        <button type="submit" className="primary-button">{busy ? "Enregistrement…" : "Enregistrer le brouillon"}</button>
        <button type="button" className="text-button" onClick={onCancel}>Annuler les modifications</button>
      </div>
    </fieldset>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

function AssignmentForm({ questionnaire, clients, assignments, selectedClientId, onCancel, onSent }: {
  questionnaire: Questionnaire; clients: ClientRecord[]; assignments: QuestionnaireAssignment[]; selectedClientId: string; onCancel: () => void; onSent: () => Promise<void>;
}) {
  const unavailable = (id: string) => assignments.some((a) => a.clientId === id && a.questionnaireId === questionnaire.id && a.status === "todo");
  const [selected, setSelected] = useState<string[]>(selectedClientId && !unavailable(selectedClientId) ? [selectedClientId] : []);
  const [dueAt, setDueAt] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try { await api.assignQuestionnaire(questionnaire.id, selected, dueAt, note); await onSent(); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="questionnaire-detail" aria-label="Envoi aux patients">
    <fieldset className="questionnaire-fieldset" disabled={busy}><legend>Destinataires</legend>
      <p className="muted">Le questionnaire apparaîtra dans leur espace privé. Aucun e-mail n’est envoyé automatiquement.</p>
      <div className="questionnaire-recipients">{clients.map((client) => <label key={client.id} className="check-label"><input type="checkbox" disabled={unavailable(client.id)} checked={selected.includes(client.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, client.id] : selected.filter((id) => id !== client.id))} /> {client.displayName}{unavailable(client.id) ? " · Déjà à compléter" : ""}</label>)}</div>
      {!clients.length && <p className="muted">Créez d’abord un profil patient.</p>}
      <label>Échéance (facultative)<input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></label>
      <label>Consigne aux patients (facultative)<textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="resource-actions"><button type="submit" className="primary-button" disabled={!selected.length}>{busy ? "Envoi…" : `Transmettre à ${selected.length} patient${selected.length > 1 ? "s" : ""}`}</button><button type="button" className="text-button" onClick={onCancel}>Annuler l’envoi</button></div>
    </fieldset>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

export function ResponseForm({ questionnaire, onSubmit, preview = false }: {
  questionnaire: Questionnaire; onSubmit?: (answers: Record<string, Answer>) => Promise<void>; preview?: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  function change(id: string, value: Answer) { setAnswers({ ...answers, [id]: value }); setErrors({ ...errors, [id]: "" }); setError(""); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    const issues: Record<string, string> = {};
    for (const q of questionnaire.questions) {
      const value = answers[q.id];
      const empty = value === undefined || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);
      if (q.required && empty) issues[q.id] = "Cette question est obligatoire.";
      else if (!empty && q.type === "multiple" && Array.isArray(value) && (value.length < (q.min ?? 0) || value.length > (q.max ?? 50))) issues[q.id] = `Sélectionnez entre ${q.min ?? 0} et ${q.max ?? q.options?.length} choix.`;
    }
    setErrors(issues);
    if (Object.keys(issues).length) { setError("Vérifiez les questions signalées ci-dessous."); return; }
    if (preview) { setError("Aperçu uniquement : aucune réponse n’est transmise."); return; }
    setBusy(true);
    try { await onSubmit?.(Object.fromEntries(Object.entries(answers).filter(([, v]) => typeof v !== "string" || v.trim()))); setSent(true); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  if (sent) return <p className="resource-feedback" role="status">Vos réponses ont bien été transmises.</p>;
  return <form className="questionnaire-response" onSubmit={submit} aria-label={preview ? "Simulation du questionnaire" : "Répondre au questionnaire"}>
    <h3>{questionnaire.title}</h3>{questionnaire.description && <p className="questionnaire-copy">{questionnaire.description}</p>}
    <p className="muted">{preview ? "Testez le formulaire avant publication." : "Vos réponses seront enregistrées lors de l’envoi. Vous pourrez ensuite les consulter."}</p>
    <fieldset disabled={busy} className="questionnaire-fieldset">
      {questionnaire.questions.map((q, index) => {
        const id = `${preview ? "preview" : "answer"}-${q.id}`;
        const value = answers[q.id];
        const props = { id, "aria-describedby": `${id}-help ${id}-error`, "aria-invalid": !!errors[q.id] };
        return <fieldset className="answer-question" key={q.id}><legend>{index + 1}. {q.label}{q.required ? " *" : " (facultatif)"}</legend>
          <p id={`${id}-help`} className="muted">{q.helpText}{q.type === "multiple" ? ` · Plusieurs choix possibles${q.min !== undefined ? `, minimum ${q.min}` : ""}${q.max !== undefined ? `, maximum ${q.max}` : ""}` : q.type === "scale" ? ` · De ${q.min ?? 0} à ${q.max ?? 10}` : ""}</p>
          {["text", "textarea"].includes(q.type) && <><label htmlFor={id} className="sr-only">{q.label}</label>{q.type === "text" ? <input {...props} value={typeof value === "string" ? value : ""} maxLength={q.maxLength ?? 10000} onChange={(e) => change(q.id, e.target.value)} /> : <textarea {...props} rows={4} value={typeof value === "string" ? value : ""} maxLength={q.maxLength ?? 10000} onChange={(e) => change(q.id, e.target.value)} />}</>}
          {q.type === "scale" && <div className="questionnaire-scale">
            <label htmlFor={id}>{typeof value === "number" ? `Valeur choisie : ${value}` : "Déplacez le curseur pour choisir une valeur"}</label>
            <input {...props} type="range" min={q.min ?? 0} max={q.max ?? 10} step={1}
              value={typeof value === "number" ? value : Math.round(((q.min ?? 0) + (q.max ?? 10)) / 2)}
              aria-valuetext={typeof value === "number" ? String(value) : "Aucune valeur sélectionnée"}
              onChange={(e) => change(q.id, Number(e.target.value))}
              onPointerUp={(e) => change(q.id, Number(e.currentTarget.value))}
              onKeyUp={(e) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) change(q.id, Number(e.currentTarget.value)); }} />
            <div className="scale-values" aria-label="Valeurs de l’échelle">{Array.from({ length: Math.max(0, Math.min(101, (q.max ?? 10) - (q.min ?? 0) + 1)) }, (_, i) => i + (q.min ?? 0))
              .filter((_, i, all) => all.length <= 21 || i === 0 || i === all.length - 1)
              .map((n) => <button key={n} type="button" className={value === n ? "scale-value selected" : "scale-value"} aria-label={`Choisir ${n} pour ${q.label}`} aria-pressed={value === n} onClick={() => change(q.id, n)}>{n}</button>)}</div>
          </div>}
          {["number", "date"].includes(q.type) && <><label htmlFor={id} className="sr-only">{q.label}</label><input {...props} type={q.type === "date" ? "date" : "number"} min={q.min} max={q.max} step={q.type === "number" ? "any" : 1} value={typeof value === "string" || typeof value === "number" ? value : ""} onChange={(e) => change(q.id, q.type === "date" || e.target.value === "" ? e.target.value : Number(e.target.value))} /></>}
          {["choice", "multiple", "boolean"].includes(q.type) && <div className="answer-options">
            {(q.type === "boolean" ? ["Oui", "Non"] : q.options ?? []).map((option) => <label className="check-label" key={option}><input type={q.type === "multiple" ? "checkbox" : "radio"} name={id} aria-describedby={`${id}-help ${id}-error`} checked={q.type === "multiple" ? Array.isArray(value) && value.includes(option) : q.type === "boolean" ? value === (option === "Oui") : value === option} onChange={(e) => change(q.id, q.type === "multiple" ? e.target.checked ? [...(Array.isArray(value) ? value : []), option] : (Array.isArray(value) ? value : []).filter((v) => v !== option) : q.type === "boolean" ? option === "Oui" : option)} /> {option}</label>)}
            {q.type !== "multiple" && !q.required && value !== undefined && value !== "" && <button type="button" className="text-button" onClick={() => change(q.id, "")}>Effacer ce choix</button>}
          </div>}
          <p id={`${id}-error`} className="error">{errors[q.id]}</p>
        </fieldset>;
      })}
      <button type="submit" className="primary-button">{busy ? "Envoi…" : preview ? "Tester la validation" : "Envoyer mes réponses"}</button>
    </fieldset>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}
