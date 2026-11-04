// Gera a migração do Drizzle. O drizzle-kit 0.28 não resolve imports relativos com ".js"
// (./esquemas/x.js e ../schema.js), então eles são tirados só durante a geração e voltam no fim.
// Uso: pnpm db:generate <nome>
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const arquivos = ["src/db/schema.ts", ...readdirSync("src/db/esquemas").filter((f) => f.endsWith(".ts")).map((f) => `src/db/esquemas/${f}`)];
const originais = new Map(arquivos.map((f) => [f, readFileSync(f, "utf8")]));
const nome = process.argv[2];
try {
  for (const [f, s] of originais) writeFileSync(f, s.replace(/"(\.\/esquemas\/[\w-]+|\.\.\/schema)\.js"/g, '"$1"'));
  const r = spawnSync("drizzle-kit", ["generate", ...(nome ? ["--name", nome] : [])], { stdio: "inherit", shell: process.platform === "win32" });
  process.exitCode = r.status ?? 1;
} finally {
  for (const [f, s] of originais) writeFileSync(f, s);
}
