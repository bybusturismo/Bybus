import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { criarDb } from "./cliente.js";

export const PASTA_MIGRACOES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export async function migrar(url: string) {
  const { db, pool } = criarDb(url);
  try {
    await migrate(db, { migrationsFolder: PASTA_MIGRACOES });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");
  await migrar(url);
  console.log("Migrações aplicadas.");
}
