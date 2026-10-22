import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { criarDb, type Db } from "./cliente.js";
import { usuarios } from "./schema.js";
import { semearReferencia } from "./referencia.js";
import { gerarHashSenha, validarPoliticaSenha } from "../seguranca/senha.js";

export { semearReferencia };

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
    const erro = validarPoliticaSenha(senha);
    if (erro) throw new Error(`ADMIN_SENHA_INICIAL fraca: ${erro}`);
    await criarAdministrador(db, email, senha);
    console.log(`Administrador ${email} pronto (troca de senha obrigatória no primeiro acesso).`);
  }
  // Lista positiva: dados fictícios (com senha pública) NUNCA em produção ou ambiente não declarado.
  if (process.env.SEMEAR_FICTICIOS === "true") {
    if (!["desenvolvimento", "testes"].includes(process.env.AMBIENTE ?? "")) throw new Error("SEMEAR_FICTICIOS só é permitido com AMBIENTE=desenvolvimento ou testes.");
    const { semearFicticios } = await import("./ficticios.js");
    await semearFicticios(db, process.env.CHAVE_CRIPTOGRAFIA!);
    console.log("Dados fictícios criados.");
  }
  await pool.end();
  console.log("Semeadura concluída.");
}
