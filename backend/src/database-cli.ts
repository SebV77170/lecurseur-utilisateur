import { join, resolve } from "node:path";
import { AppDatabase, dataDirectory } from "./database.js";

const command = process.argv[2] ?? "init";
if (!["init", "check", "backup"].includes(command)) throw new Error("Commande attendue : init, check ou backup.");
const database = new AppDatabase();
try {
  if (command === "backup") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = process.argv[3] ? resolve(process.argv[3]) : join(dataDirectory, "backups", `lecurseur-${stamp}.sqlite`);
    database.backup(destination);
    console.log(`Base sauvegardee : ${destination}`);
    console.log(`Sauvegardez aussi les fichiers du dossier : ${database.resourceDirectory}`);
  } else {
    const result = database.check();
    if (!result.ok) throw new Error("Le controle d'integrite de la base a echoue.");
    console.log(`Base SQLite ${command === "init" ? "initialisee" : "verifiee"} : ${database.file}`);
    console.log(`${database.list("users").length} comptes, ${database.list("clients").length} fiches clients, ${database.list("resources").length} ressources.`);
  }
} finally { database.close(); }
