import { and, eq } from "drizzle-orm";
import type { Canal, Categoria } from "@bybus/core";
import type { Db } from "./cliente.js";
import { passageiros, perfis, pessoas, pontosEmbarque, reservas, saidas, unidades, usuarios, usuariosUnidades } from "./schema.js";
import { semearReferencia } from "./referencia.js";
import { Cofre } from "../seguranca/cripto.js";
import { gerarHashSenha } from "../seguranca/senha.js";
import { camposDocumento } from "../servicos/passageiro.js";

/**
 * DADOS 100% FICTÍCIOS para o ambiente de testes/homologação.
 * Nenhum nome, CPF ou telefone corresponde a pessoa real. Nunca rodar em produção.
 */
export const SENHA_DEMO = "Bybus-teste-2026";
/** `unidade` null = todas as praças. */
export const USUARIOS_DEMO: Array<{ email: string; nome: string; perfil: string; unidade: string | null }> = [
  { email: "admin@bybus.test", nome: "Admin Demo", perfil: "ADMIN", unidade: null },
  { email: "supervisor@bybus.test", nome: "Supervisora Demo", perfil: "SUPERVISOR", unidade: "FLN" },
  { email: "atendente@bybus.test", nome: "Atendente Demo", perfil: "ATENDENTE", unidade: "FLN" },
  { email: "guia@bybus.test", nome: "Guia Demo", perfil: "GUIA", unidade: "FLN" },
  { email: "motorista@bybus.test", nome: "Motorista Demo", perfil: "MOTORISTA", unidade: "FLN" },
  { email: "supervisor.bc@bybus.test", nome: "Supervisor BC Demo", perfil: "SUPERVISOR", unidade: "BC" },
];

/** Guias e motoristas fictícios. */
const PESSOAS_DEMO: Array<{ nome: string; papeis: string[]; unidade: string; idiomas?: string[]; diariaCentavos?: number }> = [
  { nome: "Guia Fictícia Ana", papeis: ["GUIA"], unidade: "FLN", idiomas: ["Português", "Espanhol", "Inglês"], diariaCentavos: 30000 },
  { nome: "Guia Fictícia Bia", papeis: ["GUIA"], unidade: "FLN", idiomas: ["Português", "Espanhol"], diariaCentavos: 30000 },
  { nome: "Guia Fictício Caio", papeis: ["GUIA"], unidade: "FLN", idiomas: ["Português", "Inglês"], diariaCentavos: 30000 },
  { nome: "Motorista Fictício Davi", papeis: ["MOTORISTA"], unidade: "FLN" },
  { nome: "Motorista Fictício Edu", papeis: ["MOTORISTA"], unidade: "BC" },
  { nome: "Motorista Fictício Fred", papeis: ["MOTORISTA"], unidade: "BC" },
  { nome: "Motorista Fictício Gil", papeis: ["MOTORISTA"], unidade: "BC" },
];

const NOMES = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio", "Gabriela", "Heitor", "Isis", "João", "Karen", "Lucas", "Marina", "Nicolas", "Olívia", "Paulo", "Renata", "Samuel", "Tânia", "Vitor"];
const SOBRENOMES = ["Exemplo", "Ficticio", "Demonstracao", "Teste", "Modelo", "Amostra"];
const ESTRANGEIROS = ["John Sample", "Mary Example", "Lucía Prueba", "Pierre Exemple", "Hans Beispiel"];

/** Gera CPF com dígitos verificadores válidos a partir de uma semente (determinístico, fictício). */
export function cpfFicticio(semente: number): string {
  const base = String(100000000 + ((semente * 7919) % 899999999)).slice(0, 9).split("").map(Number);
  const dv = (d: number[]) => { const s = d.reduce((a, n, i) => a + n * (d.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join("");
}

function hojeMais(dias: number): string {
  const d = new Date(Date.now() + dias * 86400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

export async function semearFicticios(db: Db, chave: string) {
  const cofre = new Cofre(chave);
  // Proteção extra: se já houver usuário real (fora de @bybus.test), este banco não é de testes.
  const reais = await db.select({ email: usuarios.email }).from(usuarios);
  if (reais.some((u) => !u.email.endsWith("@bybus.test"))) {
    throw new Error("Banco contém usuários reais — dados fictícios não serão criados.");
  }
  const passeio = await semearReferencia(db);
  const hash = await gerarHashSenha(SENHA_DEMO);
  const listaPerfis = await db.select().from(perfis);
  const listaUnidades = await db.select().from(unidades);
  const unidadeId = (codigo: string) => listaUnidades.find((x) => x.codigo === codigo)!.id;
  for (const u of USUARIOS_DEMO) {
    const [existe] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, u.email));
    if (existe) continue;
    const [novo] = await db.insert(usuarios).values({
      nome: u.nome, email: u.email, perfilId: listaPerfis.find((p) => p.codigo === u.perfil)!.id,
      todasUnidades: u.unidade === null, senhaHash: hash, trocarSenha: false,
    }).returning({ id: usuarios.id });
    if (u.unidade) await db.insert(usuariosUnidades).values({ usuarioId: novo!.id, unidadeId: unidadeId(u.unidade) });
  }
  const jaTemPessoas = (await db.select({ id: pessoas.id }).from(pessoas).limit(1)).length > 0;
  if (!jaTemPessoas) {
    await db.insert(pessoas).values(PESSOAS_DEMO.map((p) => ({ nome: p.nome, papeis: p.papeis, unidadeId: unidadeId(p.unidade), idiomas: p.idiomas ?? [], diariaCentavos: p.diariaCentavos ?? null })));
  }

  const pontos = await db.select().from(pontosEmbarque).where(eq(pontosEmbarque.passeioId, passeio.id));
  let semente = 1;
  const canais: Canal[] = ["PAYTOUR", "PAYTOUR", "PAYTOUR", "VIATOR", "DECOLAR", "CIVITATIS", "BALCAO"];

  for (const [dia, qtdReservas] of [[1, 9], [2, 4], [3, 14]] as const) {
    const data = hojeMais(dia);
    let [saida] = await db.select().from(saidas).where(and(eq(saidas.passeioId, passeio.id), eq(saidas.data, data)));
    if (saida) continue;
    [saida] = await db.insert(saidas).values({ passeioId: passeio.id, data, capacidade: 73, veiculo: "QJQ2A16 (fictício)" }).returning();

    for (let i = 0; i < qtdReservas; i++) {
      const canal = canais[(i + dia) % canais.length]!;
      const estrangeiro = canal === "VIATOR";
      const titular = estrangeiro ? ESTRANGEIROS[i % ESTRANGEIROS.length]! : `${NOMES[(i * 3 + dia) % NOMES.length]} ${SOBRENOMES[i % SOBRENOMES.length]}`;
      const semPonto = canal !== "PAYTOUR" && canal !== "BALCAO" && i % 2 === 0;
      const ponto = semPonto ? null : pontos[(i * 5 + dia) % pontos.length]!;
      const [r] = await db.insert(reservas).values({
        saidaId: saida!.id,
        canal,
        canalOrigem: canal,
        codigoExterno: `${canal}-DEMO-${dia}${String(i).padStart(3, "0")}`,
        contatoNome: titular,
        contatoTelefone: `+55 48 90000-${String(1000 + semente).slice(-4)}`,
        pontoEmbarqueId: ponto?.id ?? null,
        origem: "FICTICIO",
      }).returning();
      const tamanho = 1 + ((i + dia) % 4);
      const categorias: Categoria[] = ["ADULTO", "ADULTO", "INFANTIL", "SENIOR", "COLO"];
      await db.insert(passageiros).values(Array.from({ length: tamanho }, (_, k) => {
        semente++;
        const nome = k === 0 ? titular : estrangeiro && k > 1 ? "" : `${NOMES[(semente * 7) % NOMES.length]} ${titular.split(" ").pop()}`;
        const documento = estrangeiro ? (k === 0 ? camposDocumento(cofre, "PASSAPORTE", `X${String(1000000 + semente)}`) : camposDocumento(cofre, null, null)) : camposDocumento(cofre, "CPF", cpfFicticio(semente));
        return { reservaId: r!.id, nome, categoria: categorias[k % categorias.length]!, ...documento, documentoPais: estrangeiro && k === 0 ? "EUA (fictício)" : null };
      }));
    }
  }
}
