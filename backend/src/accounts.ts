import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { AppDatabase } from "./database.js";
import type { ClientRecord, User } from "./types.js";

const invitationLifetime = 72 * 60 * 60 * 1000;
function digest(token: string) { return createHash("sha256").update(token).digest("hex"); }
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key));
  });
}

export class AccountStore {
  constructor(private database: AppDatabase) {}

  async verifyPassword(user: User, password: string) {
    const encoded = this.database.find("credentials", { userId: user.id })?.hash;
    if (!encoded || user.invitationStatus !== "accepted") return false;
    const [salt, expected] = encoded.split(":");
    const actual = await derive(password, salt);
    return timingSafeEqual(actual, Buffer.from(expected, "hex"));
  }

  private invitation(user: User) {
    const token = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + invitationLifetime;
    this.database.put("invitations", { userId: user.id, digest: digest(token), expiresAt });
    const url = new URL(process.env.FRONTEND_ORIGIN ?? "http://localhost:5180");
    url.pathname = "/";
    url.hash = `invitation=${token}`;
    return { url: url.toString(), expiresAt: new Date(expiresAt).toISOString() };
  }

  createInvitation(user: User, client?: ClientRecord) {
    return this.database.transaction(() => {
      if (client) this.database.insert("clients", client);
      this.database.insert("users", user);
      const invitation = this.invitation(user);
      this.database.addAudit(user.invitedBy!, "account.invited", user.id, { role: user.role });
      return invitation;
    });
  }

  issueInvitation(user: User, actorId: string) {
    return this.database.transaction(() => {
      const invitation = this.invitation(user);
      this.database.addAudit(actorId, "account.reinvited", user.id);
      return invitation;
    });
  }

  resolveInvitation(token: string) {
    const invitation = this.database.find("invitations", { digest: digest(token) });
    if (!invitation || invitation.expiresAt <= Date.now()) return null;
    const user = this.database.find("users", { id: invitation.userId, invitationStatus: "pending" });
    return user ? { user, expiresAt: new Date(invitation.expiresAt).toISOString() } : null;
  }

  async acceptInvitation(token: string, password: string) {
    if (!this.resolveInvitation(token)) return null;
    const salt = randomBytes(16).toString("hex");
    const key = await derive(password, salt);
    // Lock and re-read after hashing, including activation from another connection.
    return this.database.transaction(() => {
      const resolved = this.resolveInvitation(token);
      if (!resolved) return null;
      this.database.put("credentials", { userId: resolved.user.id, hash: `${salt}:${key.toString("hex")}` });
      const user = { ...resolved.user, invitationStatus: "accepted" as const };
      this.database.put("users", user);
      this.database.remove("invitations", { userId: user.id });
      const client = user.clientId ? this.database.find("clients", { id: user.clientId }) : undefined;
      if (client) this.database.put("clients", { ...client, status: "active", tags: client.tags.filter((tag) => tag !== "invitation en attente") });
      this.database.addAudit(user.id, "account.activated", user.id);
      return user;
    });
  }
}
