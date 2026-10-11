import { createApp } from "./app.js";
import { AppDatabase } from "./database.js";

const port = Number(process.env.PORT ?? 4000);
const database = new AppDatabase();
const app = createApp({ database });

const server = app.listen(port, () => {
  console.log(`Le Curseur API listening on http://localhost:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close(() => { database.close(); }));
}

