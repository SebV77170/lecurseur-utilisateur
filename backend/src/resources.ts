import { randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { AppDatabase } from "./database.js";
import type { Resource, ResourceAssignment } from "./types.js";

export const maximumFileSize = 20 * 1024 * 1024;

// Check bytes as well as extensions; never serve HTML or SVG as an uploaded image.
export function inspectFile(name: string, bytes: Buffer): { type: Resource["type"]; mimeType: string } | null {
  const extension = extname(name).toLowerCase();
  const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const text = (start: number, end: number) => bytes.subarray(start, end).toString("ascii");
  if (extension === ".pdf" && text(0, 5) === "%PDF-") return { type: "pdf", mimeType: "application/pdf" };
  if (extension === ".png" && starts([137, 80, 78, 71, 13, 10, 26, 10])) return { type: "image", mimeType: "image/png" };
  if ([".jpg", ".jpeg"].includes(extension) && starts([255, 216, 255])) return { type: "image", mimeType: "image/jpeg" };
  if (extension === ".webp" && text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return { type: "image", mimeType: "image/webp" };
  if (extension === ".wav" && text(0, 4) === "RIFF" && text(8, 12) === "WAVE") return { type: "audio", mimeType: "audio/wav" };
  if (extension === ".mp3" && (text(0, 3) === "ID3" || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0))) return { type: "audio", mimeType: "audio/mpeg" };
  if (extension === ".ogg" && text(0, 4) === "OggS") return { type: "audio", mimeType: "audio/ogg" };
  if (extension === ".m4a" && text(4, 8) === "ftyp" && ["M4A ", "isom", "mp42"].includes(text(8, 12))) return { type: "audio", mimeType: "audio/mp4" };
  return null;
}

export class ResourceStore {
  constructor(readonly directory: string, private database: AppDatabase) {}
  get resources() { return this.database.list("resources"); }
  get assignments() { return this.database.list("resource_assignments"); }

  filePath(resource: Resource) { return join(this.directory, `${resource.id}.bin`); }

  add(input: Pick<Resource, "title" | "description" | "fileName" | "type" | "mimeType">, bytes: Buffer, actorId: string) {
    const id = `r-${randomUUID()}`;
    const resource: Resource = {
      ...input, id, url: `/api/resources/${id}/file`, size: bytes.length,
      uploadedAt: new Date().toISOString(), sensitivity: "standard"
    };
    mkdirSync(this.directory, { recursive: true });
    writeFileSync(this.filePath(resource), bytes, { flag: "wx", mode: 0o600 });
    try { this.database.transaction(() => {
      this.database.insert("resources", resource);
      this.database.addAudit(actorId, "resource.uploaded", resource.id);
    }); }
    catch (error) { unlinkSync(this.filePath(resource)); throw error; }
    return resource;
  }

  assign(resourceId: string, clientId: string, assignedBy: string, note: string) {
    return this.database.transaction(() => {
      const previous = this.database.find("resource_assignments", { resourceId, clientId });
      const assignment: ResourceAssignment = {
        id: previous?.id ?? `a-${randomUUID()}`, resourceId, clientId, assignedBy, note,
        assignedAt: new Date().toISOString()
      };
      this.database.put("resource_assignments", assignment);
      this.database.addAudit(assignedBy, "resource.assigned", clientId, { resourceId });
      return assignment;
    });
  }

  unassign(resourceId: string, clientId: string, actorId: string) {
    this.database.transaction(() => {
      this.database.remove("resource_assignments", { resourceId, clientId });
      this.database.addAudit(actorId, "resource.unassigned", clientId, { resourceId });
    });
  }
}
