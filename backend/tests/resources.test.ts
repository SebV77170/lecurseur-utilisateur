import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { signUser } from "../src/auth.js";
import { users } from "../src/data.js";
import { maximumFileSize } from "../src/resources.js";
import { AppDatabase } from "../src/database.js";

const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1kAAAAASUVORK5CYII=", "base64");
const admin = `Bearer ${signUser(users.find((user) => user.id === "u-admin")!)}`;
const practitioner = `Bearer ${signUser(users.find((user) => user.id === "u-praticienne")!)}`;
const client = `Bearer ${signUser(users.find((user) => user.id === "u-camille")!)}`;

describe("real resource files", () => {
  let directory: string;
  let app: ReturnType<typeof createApp>;
  let databases: AppDatabase[];
  const openApp = () => {
    const application = createApp({ file: join(directory, "test.sqlite"), legacyAccountsFile: null, resourceDirectory: directory });
    databases.push(application.locals.database);
    return application;
  };
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "curseur-resources-test-"));
    databases = [];
    app = openApp();
  });
  afterEach(() => {
    databases.forEach((database) => database.close());
    if (!directory.startsWith(join(tmpdir(), "curseur-resources-test-"))) throw new Error("Unexpected test directory");
    rmSync(directory, { recursive: true, force: true });
  });
  const upload = (app: ReturnType<typeof createApp>, bytes = image, fileName = "visuel.png", token = practitioner) =>
    request(app).post("/resources").query({ title: "Support personnel", fileName, description: "A consulter" })
      .set("Authorization", token).set("Content-Type", "application/octet-stream").send(bytes);

  it("starts without fictional resources and limits imports to staff", async () => {
    expect((await request(app).get("/resources").set("Authorization", admin)).body.resources).toEqual([]);
    expect((await upload(app, image, "visuel.png", client)).status).toBe(403);
    expect((await request(app).get("/resources")).status).toBe(401);
  });

  it("saves exact bytes, requires assignment, persists after restart, and revokes access", async () => {
    const result = await upload(app);
    expect(result.status).toBe(201);
    const id = result.body.resource.id;
    expect(result.body.resource).toMatchObject({ fileName: "visuel.png", size: image.length, mimeType: "image/png" });
    expect((await request(app).get(`/resources/${id}/file`)).status).toBe(401);
    expect((await request(app).get(`/resources/${id}/file`).set("Authorization", client)).status).toBe(404);
    expect((await request(app).get("/resources").set("Authorization", client)).body.resources).toEqual([]);

    const assigned = await request(app).post(`/resources/${id}/assign`).set("Authorization", practitioner)
      .send({ clientId: "c-camille", note: "Votre consigne" });
    expect(assigned.status).toBe(201);
    await request(app).post(`/resources/${id}/assign`).set("Authorization", practitioner).send({ clientId: "c-camille", note: "Mise a jour" });

    const restarted = openApp();
    const listing = await request(restarted).get("/resources").set("Authorization", client);
    expect(listing.body.resources).toHaveLength(1);
    expect(listing.body.assignments).toHaveLength(1);
    expect(listing.body.assignments[0].note).toBe("Mise a jour");
    const file = await request(restarted).get(`/resources/${id}/file`).set("Authorization", client);
    expect(file.status).toBe(200);
    expect(file.body).toEqual(image);
    expect(file.headers["cache-control"]).toContain("no-store");
    expect(file.headers["content-disposition"]).toContain("visuel.png");
    const range = await request(restarted).get(`/resources/${id}/file`).set("Authorization", client).set("Range", "bytes=0-7");
    expect(range.status).toBe(206);
    expect(range.body).toEqual(image.subarray(0, 8));

    expect((await request(restarted).delete(`/resources/${id}/assign/c-camille`).set("Authorization", practitioner)).status).toBe(200);
    const afterRevocation = openApp();
    expect((await request(afterRevocation).get(`/resources/${id}/file`).set("Authorization", client)).status).toBe(404);
  });

  it("rejects unsupported, disguised, empty, oversized, and unsafe filenames", async () => {
    expect((await upload(app, Buffer.from("<script>alert(1)</script>"), "pretend.pdf")).status).toBe(415);
    expect((await upload(app, Buffer.from("<svg></svg>"), "visuel.svg")).status).toBe(415);
    expect((await upload(app, Buffer.alloc(0))).status).toBe(400);
    expect((await upload(app, image, "../visuel.png")).status).toBe(400);
    expect((await upload(app, Buffer.alloc(maximumFileSize + 1))).status).toBe(413);
  });

  it("blocks practitioners from assigning to another practitioner's client", async () => {
    const outsider = { id: "u-resource-outsider", email: "outsider@example.test", displayName: "Autre praticien", role: "praticien" as const, invitationStatus: "accepted" as const };
    const database: AppDatabase = app.locals.database;
    database.insert("users", outsider);
    try {
      const uploaded = await upload(app);
      const result = await request(app).post(`/resources/${uploaded.body.resource.id}/assign`)
        .set("Authorization", `Bearer ${signUser(outsider)}`).send({ clientId: "c-camille" });
      expect(result.status).toBe(403);
      const revoke = await request(app).delete(`/resources/${uploaded.body.resource.id}/assign/c-camille`)
        .set("Authorization", `Bearer ${signUser(outsider)}`);
      expect(revoke.status).toBe(403);
    } finally { database.remove("users", { id: outsider.id }); }
  });

  it("imports PDF and WAV with a server-detected MIME type", async () => {
    const pdf = await upload(app, Buffer.from("%PDF-1.4\n%%EOF\n"), "support.pdf");
    expect(pdf.status).toBe(201);
    expect(pdf.body.resource.mimeType).toBe("application/pdf");
    const wav = Buffer.alloc(48);
    wav.write("RIFF", 0); wav.writeUInt32LE(40, 4); wav.write("WAVE", 8);
    wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(4, 40);
    const audio = await upload(app, wav, "audio.wav");
    expect(audio.status).toBe(201);
    expect(audio.body.resource.mimeType).toBe("audio/wav");
  });
});
