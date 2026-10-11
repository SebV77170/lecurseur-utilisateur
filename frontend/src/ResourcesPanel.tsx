import { Download, Eye, FileAudio, FileText, Image, Upload, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ClientRecord, Resource, ResourceAssignment, User } from "./types";

const accept = ".pdf,.mp3,.wav,.m4a,.ogg,.png,.jpg,.jpeg,.webp";
const iconByType = { pdf: FileText, audio: FileAudio, image: Image };
const sizeLabel = (size: number) => size < 1024 * 1024 ? `${Math.ceil(size / 1024)} Ko` : `${(size / 1024 / 1024).toFixed(1)} Mo`;

export function ResourcesPanel({ user, resources, assignments, clients, selectedClientId, onRefresh }: {
  user: User; resources: Resource[]; assignments: ResourceAssignment[]; clients: ClientRecord[];
  selectedClientId: string; onRefresh: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState<{ resource: Resource; url: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const client = clients.find((item) => item.id === selectedClientId);
  const canManage = user.role !== "client";

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(""); setStatus("");
    try { await action(); }
    catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Operation impossible."); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) { setError("Choisissez un fichier a importer."); return; }
    if (!file.size || file.size > 20 * 1024 * 1024) {
      setError("Choisissez un fichier non vide de 20 Mo maximum."); return;
    }
    await perform(async () => {
      await api.uploadResource(file, title, description);
      setFile(null); setTitle(""); setDescription("");
      if (fileInput.current) fileInput.current.value = "";
      setStatus("Fichier importe dans la bibliotheque. Vous pouvez maintenant l'attribuer a un client.");
      await onRefresh();
    });
  }

  async function openFile(resource: Resource, download: boolean) {
    await perform(async () => {
      const blob = await api.resourceFile(resource.id);
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob);
      if (download) {
        const link = document.createElement("a");
        link.href = url; link.download = resource.fileName;
        document.body.appendChild(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus("Telechargement lance.");
      } else setPreview({ resource, url });
    });
  }

  async function assign(resource: Resource, remove: boolean) {
    if (!client) return;
    await perform(async () => {
      if (remove) await api.unassignResource(resource.id, client.id);
      else await api.assignResource(resource.id, client.id, note);
      setStatus(remove ? `Acces retire pour ${client.displayName}.` : `Ressource attribuee a ${client.displayName}.`);
      await onRefresh();
    });
  }

  return (
    <section className="panel" id="ressources" aria-labelledby="resources-title">
      <div className="panel-heading">
        <div><p className="eyebrow">Bibliotheque</p><h2 id="resources-title">PDF, audio et images</h2></div>
        <span className="badge">{resources.length} fichier{resources.length > 1 ? "s" : ""}</span>
      </div>
      {canManage ? <form className="resource-upload" aria-label="Importer une ressource" onSubmit={(event) => void upload(event)}>
        <h3>Ajouter un fichier</h3>
        <p className="muted">PDF, MP3, WAV, M4A, OGG, PNG, JPEG ou WebP. 20 Mo maximum par fichier.</p>
        <div className="resource-fields">
          <label>Fichier<input type="file" accept={accept} ref={fileInput} required disabled={busy} onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null;
            setFile(chosen); setError("");
            if (chosen && !title) setTitle(chosen.name.replace(/\.[^.]+$/, "").slice(0, 120));
          }} /></label>
          <label>Titre de la ressource<input value={title} minLength={2} maxLength={120} required disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Description (facultatif)<input value={description} maxLength={1000} disabled={busy} onChange={(event) => setDescription(event.target.value)} /></label>
        </div>
        <button className="primary-button" type="submit" disabled={busy}><Upload size={17} aria-hidden />{busy ? "En cours..." : "Importer le fichier"}</button>
      </form> : null}
      {canManage && resources.length > 0 ? <div className="resource-assignment-context">
        <p>{client ? <>Attribution pour <strong>{client.displayName}</strong> (client selectionne ci-dessus).</> : "Selectionnez un client ci-dessus pour lui attribuer des fichiers."}</p>
        {client ? <label>Consigne au client (facultatif)<input value={note} maxLength={500} disabled={busy} onChange={(event) => setNote(event.target.value)} /></label> : null}
      </div> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {status ? <p className="resource-feedback" role="status">{status}</p> : null}
      {resources.length === 0 ? <div className="resource-empty"><FileText size={30} aria-hidden /><p>{canManage ? "Aucun fichier pour le moment. Importez votre premiere ressource ci-dessus." : "Aucune ressource ne vous a encore ete attribuee."}</p></div> : null}
      <div className="resource-grid">
        {resources.map((resource) => {
          const Icon = iconByType[resource.type];
          const assignment = assignments.find((item) => item.resourceId === resource.id && item.clientId === selectedClientId);
          return <article className="resource-card" key={resource.id}>
            <Icon size={22} aria-hidden /><h3>{resource.title}</h3>
            {resource.description ? <p>{resource.description}</p> : null}
            <small className="resource-filename">{resource.fileName}</small>
            <div className="resource-meta"><span>{resource.type.toUpperCase()}</span><span>{sizeLabel(resource.size)}</span><span>{assignment ? "Attribue" : "Bibliotheque"}</span></div>
            {assignment?.note ? <p className="resource-note">{assignment.note}</p> : null}
            <div className="resource-actions">
              <button type="button" className="small-button" disabled={busy} onClick={() => void openFile(resource, false)}><Eye size={16} aria-hidden />{resource.type === "audio" ? "Ecouter" : "Consulter"}</button>
              <button type="button" className="small-button" disabled={busy} onClick={() => void openFile(resource, true)}><Download size={16} aria-hidden />Telecharger</button>
              {canManage && client ? <button type="button" className="text-button" disabled={busy} onClick={() => void assign(resource, Boolean(assignment))}>{assignment ? "Retirer l'acces" : `Attribuer a ${client.displayName}`}</button> : null}
            </div>
          </article>;
        })}
      </div>
      {preview ? <div className="resource-preview" role="region" aria-label={`Apercu : ${preview.resource.title}`}>
        <div className="panel-heading"><h3>{preview.resource.title}</h3><button type="button" className="icon-button" aria-label="Fermer l'apercu" onClick={() => setPreview(null)}><X size={20} aria-hidden /></button></div>
        {preview.resource.type === "image" ? <img src={preview.url} alt={preview.resource.title} /> : preview.resource.type === "audio" ? <audio src={preview.url} controls autoPlay /> : <iframe src={preview.url} title={`PDF : ${preview.resource.title}`} />}
        <p className="muted">Si l'apercu n'est pas disponible dans votre navigateur, utilisez Telecharger.</p>
      </div> : null}
    </section>
  );
}
