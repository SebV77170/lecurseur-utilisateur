import { z } from "zod";

// Validate legacy files before importing anything. Invalid files must never reset accounts.
export const accountSnapshotSchema = z.object({
  version: z.literal(1),
  users: z.array(z.object({
    id: z.string(), email: z.string().email(), displayName: z.string(),
    role: z.enum(["admin", "praticien", "client"]), clientId: z.string().optional(),
    invitedBy: z.string().optional(), invitationStatus: z.enum(["pending", "accepted"])
  })),
  clients: z.array(z.object({
    id: z.string(), displayName: z.string(), email: z.string().email(),
    status: z.enum(["active", "paused", "archived"]), createdAt: z.string(), tags: z.array(z.string()),
    assignedPractitionerId: z.string(), careNotesSummary: z.string(),
    rgpdConsent: z.object({ collectedAt: z.string(), version: z.string(), scope: z.array(z.string()) })
  })),
  credentials: z.record(z.string().regex(/^[a-f0-9]{32}:[a-f0-9]{128}$/)),
  invitations: z.array(z.object({ userId: z.string(), digest: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number() }))
});

export const resourceSnapshotSchema = z.object({
  version: z.literal(1),
  resources: z.array(z.object({
    id: z.string().regex(/^r-[a-f0-9-]{36}$/), title: z.string(), description: z.string(),
    type: z.enum(["pdf", "audio", "image"]), url: z.string(), uploadedAt: z.string(),
    sensitivity: z.enum(["standard", "sensitive"]), fileName: z.string(), mimeType: z.string(),
    size: z.number().int().positive().max(20 * 1024 * 1024)
  })),
  assignments: z.array(z.object({
    id: z.string(), clientId: z.string(), resourceId: z.string(), assignedAt: z.string(),
    assignedBy: z.string(), note: z.string()
  }))
});
