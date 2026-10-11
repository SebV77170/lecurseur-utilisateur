import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { demoPassword } from "../src/data.js";

const app = createApp();
afterAll(() => app.locals.database.close());

async function login(email: string) {
  const response = await request(app).post("/auth/login").send({ email, password: demoPassword });
  return response.body.token as string;
}

describe("authentication and permissions", () => {
  it("allows a demo admin to log in", async () => {
    const response = await request(app).post("/auth/login").send({
      email: "admin@lecurseur.local",
      password: demoPassword
    });

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe("admin");
    expect(response.body.token).toBeTypeOf("string");
  });

  it("blocks clients from reading the full client administration list", async () => {
    const token = await login("camille.client@example.test");

    const response = await request(app).get("/clients").set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it("lets a client submit an assigned questionnaire", async () => {
    const token = await login("camille.client@example.test");

    const response = await request(app)
      .post("/questionnaires/responses")
      .set("Authorization", `Bearer ${token}`)
      .send({
        assignmentId: "qa-camille-1",
        answers: {
          q1: "Reponse fictive de demonstration.",
          q2: 4
        }
      });

    expect(response.status).toBe(201);
    expect(response.body.response.clientId).toBe("c-camille");
  });
});

