import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AccountStore } from "../src/accounts.js";
import { createApp } from "../src/app.js";
import { demoPassword } from "../src/data.js";
import { AppDatabase } from "../src/database.js";
import type { User } from "../src/types.js";

const app = createApp();
const database: AppDatabase = app.locals.database;
afterAll(() => database.close());
let admin: string;
let practitioner: string;
let client: string;
const personalPassword = "MonMotDePassePersonnel!42";

function invitationToken(response: request.Response) {
  return new URLSearchParams(new URL(response.body.invitation.url).hash.slice(1)).get("invitation")!;
}

async function invite(email: string, token = practitioner, extra: Record<string, unknown> = {}) {
  return request(app).post("/users/invitations").set("Authorization", `Bearer ${token}`)
    .send({ email, displayName: "Profil de verification", role: "client", ...extra });
}

beforeAll(async () => {
  const tokens = await Promise.all(["admin@lecurseur.local", "praticienne@lecurseur.local", "camille.client@example.test"].map(async (email) => {
    const result = await request(app).post("/auth/login").send({ email, password: demoPassword });
    expect(result.status).toBe(200);
    return result.body.token as string;
  }));
  [admin, practitioner, client] = tokens;
});
afterEach(() => vi.restoreAllMocks());

describe("profile creation and access", () => {
  it("requires authentication and blocks clients from managing profiles", async () => {
    expect((await request(app).post("/users/invitations").send({})).status).toBe(401);
    expect((await invite("forbidden@example.test", client)).status).toBe(403);
    expect((await request(app).get("/users").set("Authorization", `Bearer ${client}`)).status).toBe(403);
  });

  it.each(["admin", "praticien"])("prevents a practitioner from creating a %s", async (role) => {
    expect((await invite(`forbidden-${role}@example.test`, practitioner, { role })).status).toBe(403);
  });

  it("assigns a practitioner's new client to that practitioner, ignoring a supplied assignment", async () => {
    const result = await invite("assigned@example.test", practitioner, { practitionerId: "u-admin" });
    expect(result.status).toBe(201);
    expect(result.body.client.assignedPractitionerId).toBe("u-praticienne");
    expect(result.body.user.invitationStatus).toBe("pending");
    expect(result.body.user).not.toHaveProperty("password");
    expect(result.body.client.rgpdConsent.collectedAt).toBe("");
    expect(result.body.invitation.url).toContain("#invitation=");
  });

  it("rejects invalid names, roles, addresses and duplicate emails regardless of case", async () => {
    expect((await invite("invalid")).status).toBe(400);
    expect((await invite("bad-name@example.test", practitioner, { displayName: "  " })).status).toBe(400);
    expect((await invite("bad-role@example.test", admin, { role: "superadmin" })).status).toBe(400);
    expect((await invite("  CAMILLE.CLIENT@example.test  ")).status).toBe(409);
  });

  it("requires an active practitioner for an admin-created client", async () => {
    expect((await invite("missing-practitioner@example.test", admin)).status).toBe(400);
    expect((await invite("invalid-practitioner@example.test", admin, { practitionerId: "u-admin" })).status).toBe(400);
    expect((await invite("valid-practitioner@example.test", admin, { practitionerId: "u-praticienne" })).status).toBe(201);
  });

  it.each(["admin", "praticien"])("allows an admin to invite and activate a %s", async (role) => {
    const result = await invite(`new-${role}@example.test`, admin, { role });
    expect(result.status).toBe(201);
    expect(result.body).not.toHaveProperty("client");
    const activated = await request(app).post("/auth/invitations/accept").send({ token: invitationToken(result), password: personalPassword });
    expect(activated.status).toBe(200);
    expect(activated.body.user.role).toBe(role);
    const list = await request(app).get("/clients").set("Authorization", `Bearer ${activated.body.token}`);
    expect(list.status).toBe(200);
    if (role === "praticien") expect(list.body.clients).toEqual([]);
  });
});

describe("invitation activation", () => {
  it("allows only the personal password after activation and consumes the invitation", async () => {
    const created = await invite("activation@example.test");
    const token = invitationToken(created);
    expect((await request(app).post("/auth/login").send({ email: created.body.user.email, password: demoPassword })).status).toBe(401);
    const details = await request(app).post("/auth/invitations/resolve").send({ token });
    expect(details.status).toBe(200);
    expect(details.headers["cache-control"]).toBe("no-store");
    expect(details.body.user.email).toBe(created.body.user.email);
    expect((await request(app).post("/auth/invitations/accept").send({ token, password: "short" })).status).toBe(400);
    const activated = await request(app).post("/auth/invitations/accept").send({ token, password: personalPassword });
    expect(activated.status).toBe(200);
    expect(activated.body.user.invitationStatus).toBe("accepted");
    expect(database.find("clients", { id: activated.body.user.clientId })?.status).toBe("active");
    expect((await request(app).post("/auth/login").send({ email: created.body.user.email, password: demoPassword })).status).toBe(401);
    expect((await request(app).post("/auth/login").send({ email: created.body.user.email.toUpperCase(), password: personalPassword })).status).toBe(200);
    expect((await request(app).post("/auth/invitations/accept").send({ token, password: personalPassword })).status).toBe(410);
    expect((await request(app).post("/auth/invitations/resolve").send({ token })).status).toBe(410);
  });

  it("rejects invalid and expired links", async () => {
    expect((await request(app).post("/auth/invitations/resolve").send({ token: "invalid" })).status).toBe(410);
    const created = await invite("expired@example.test");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 73 * 60 * 60 * 1000);
    expect((await request(app).post("/auth/invitations/accept").send({ token: invitationToken(created), password: personalPassword })).status).toBe(410);
  });

  it("renews pending invitations and invalidates the previous link", async () => {
    const created = await invite("renew@example.test");
    const renewed = await request(app).post(`/users/${created.body.user.id}/invitation`).set("Authorization", `Bearer ${practitioner}`);
    expect(renewed.status).toBe(200);
    expect((await request(app).post("/auth/invitations/resolve").send({ token: invitationToken(created) })).status).toBe(410);
    expect((await request(app).post("/auth/invitations/resolve").send({ token: invitationToken(renewed) })).status).toBe(200);
  });

  it("hides other practitioners' clients and blocks renewal of active or staff accounts", async () => {
    const login = await request(app).post("/auth/login").send({ email: "new-praticien@example.test", password: personalPassword });
    const list = await request(app).get("/users").set("Authorization", `Bearer ${login.body.token}`);
    expect(list.body.users).toEqual([]);
    expect((await request(app).post("/users/u-noa/invitation").set("Authorization", `Bearer ${login.body.token}`)).status).toBe(404);
    expect((await request(app).post("/users/u-admin/invitation").set("Authorization", `Bearer ${practitioner}`)).status).toBe(404);
    expect((await request(app).post("/users/u-camille/invitation").set("Authorization", `Bearer ${admin}`)).status).toBe(409);
  });

  it("prevents concurrent uses of the same link", async () => {
    const created = await invite("concurrent@example.test");
    const results = await Promise.all([1, 2].map(() => request(app).post("/auth/invitations/accept").send({ token: invitationToken(created), password: personalPassword })));
    expect(results.map((result) => result.status).sort()).toEqual([200, 410]);
  });
});

it("persists profiles and credentials across reloads without storing passwords or raw invitation tokens", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "lecurseur-accounts-"));
  try {
    const file = join(temporaryDirectory, "accounts.sqlite");
    const pending: User = { id: "persisted", email: "persisted@example.test", displayName: "Compte conserve", role: "praticien", invitationStatus: "pending", invitedBy: "u-admin" };
    const initial = new AppDatabase({ file, legacyAccountsFile: null, resourceDirectory: temporaryDirectory });
    const store = new AccountStore(initial);
    const invitation = store.createInvitation(pending);
    const token = new URLSearchParams(new URL(invitation.url).hash.slice(1)).get("invitation")!;
    initial.close();
    expect(readFileSync(file, "utf8")).not.toContain(token);
    const reloaded = new AppDatabase({ file, legacyAccountsFile: null, resourceDirectory: temporaryDirectory });
    const restored = new AccountStore(reloaded);
    expect(restored.resolveInvitation(token)?.user.email).toBe(pending.email);
    await restored.acceptInvitation(token, personalPassword);
    reloaded.close();
    const last = new AppDatabase({ file, legacyAccountsFile: null, resourceDirectory: temporaryDirectory });
    const final = new AccountStore(last);
    expect(await final.verifyPassword(last.find("users", { id: pending.id })!, personalPassword)).toBe(true);
    expect(final.resolveInvitation(token)).toBeNull();
    last.close();
    expect(readFileSync(file, "utf8")).not.toContain(personalPassword);
  } finally {
    // This directory is created by this test under the operating system temp directory.
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
