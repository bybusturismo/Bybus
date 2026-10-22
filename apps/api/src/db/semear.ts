import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { PONTOS_TODA_ILHA } from "@bybus/core";
import { criarDb, type Db } from "./cliente.js";
import { passeios, pontosEmbarque, usuarios } from "./schema.js";
import { gerarHashSenha } from "../seguranca/senha.js";

/** Dados de referência (passeio e pontos oficiais) — seguros para qualquer ambiente. */
export async function semearReferencia(db: Db) {
  let [passeio] = await db.select().from(passeios).where(eq(passeios.codigo, "TODA_ILHA"));
  if (!passeio) {
    [passeio] = await db.insert(passeios).values({
      codigo: "TODA_ILHA",
      nome: "City Tour Toda Ilha",
      cidade: "Florianópolis",
      capacidadePadrao: 73,
      minimoConfirmacao: 12,
      minimoSupervisor: 10,
      padraoProduto: "toda ilha|whole island|floripa city tour",
    }).returning();
  }
  for (const p of PONTOS_TODA_ILHA) {
    const [existe] = await db.select({ id: pontosEmbarque.id }).from(pontosEmbarque).where(and(eq(pontosEmbarque.passeioId, passeio!.id), eq(pontosEmbarque.ordem, p.ordem)));
    if (!existe) await db.insert(pontosEmbarque).values({ ...p, passeioId: passeio!.id });
  }
  return passeio!;
}

/** Cria o primeiro administrador com senha temporária (troca obrigatória no primeiro acesso). */
export async function criarAdministrador(db: Db, email: string, senha: string, nome = "Administrador") {
  const [existe] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, email.toLowerCase()));
  if (existe) return existe.id;
  const [u] = await db.insert(usuarios).values({ nome, email: email.toLowerCase(), perfil: "ADMIN", senhaHash: await gerarHashSenha(senha), trocarSenha: true }).returning({ id: usuarios.id });
  return u!.id;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");
  const { db, pool } = criarDb(url);
  await semearReferencia(db);
  const email = process.env.ADMIN_EMAIL;
  const senha = process.env.ADMIN_SENHA_INICIAL;
  if (email && senha) {
    await criarAdministrador(db, email, senha);
    console.log(`Administrador ${email} pronto (troca de senha obrigatória no primeiro acesso).`);
  }
  if (process.env.AMBIENTE !== "producao" && process.env.SEMEAR_FICTICIOS === "true") {
    const { semearFicticios } = await import("./ficticios.js");
    await semearFicticios(db, process.env.CHAVE_CRIPTOGRAFIA!);
    console.log("Dados fictícios criados.");
  }
  await pool.end();
  console.log("Semeadura concluída.");
}
