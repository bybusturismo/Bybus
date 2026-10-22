import { asc, eq, inArray } from "drizzle-orm";
import { detectarDuplicatas, formatarCpf, montarManifesto, type Manifesto, type ReservaManifesto } from "@bybus/core";
import type { Db } from "../db/cliente.js";
import { passageiros, passeios, pontosEmbarque, reservas, saidas } from "../db/schema.js";
import type { Cofre } from "../seguranca/cripto.js";
import { ErroHttp } from "../seguranca/sessao.js";
import { documentoMascarado } from "./passageiro.js";

export interface OpcoesManifesto {
  documentosCompletos: boolean;
  mostrarContatos: boolean;
}

export async function carregarManifesto(db: Db, cofre: Cofre, saidaId: string, opcoes: OpcoesManifesto) {
  const [linha] = await db
    .select({ saida: saidas, passeio: passeios })
    .from(saidas)
    .innerJoin(passeios, eq(passeios.id, saidas.passeioId))
    .where(eq(saidas.id, saidaId));
  if (!linha) throw new ErroHttp(404, "NAO_ENCONTRADO", "Saída não encontrada.");

  const pontos = await db.select().from(pontosEmbarque).where(eq(pontosEmbarque.passeioId, linha.passeio.id)).orderBy(asc(pontosEmbarque.ordem));
  const listaReservas = await db.select().from(reservas).where(eq(reservas.saidaId, saidaId));
  const listaPassageiros = listaReservas.length
    ? await db.select().from(passageiros).where(inArray(passageiros.reservaId, listaReservas.map((r) => r.id))).orderBy(asc(passageiros.criadoEm), asc(passageiros.id))
    : [];

  const reservasManifesto: ReservaManifesto[] = listaReservas.map((r) => ({
    id: r.id,
    canal: r.canal,
    codigoExterno: r.codigoExterno,
    contatoNome: r.contatoNome,
    contatoTelefone: opcoes.mostrarContatos ? r.contatoTelefone : null,
    pontoEmbarqueId: r.pontoEmbarqueId,
    status: r.status,
    observacoes: r.observacoes,
    passageiros: listaPassageiros
      .filter((p) => p.reservaId === r.id)
      .map((p) => {
        let documento = documentoMascarado(p.documentoFinal);
        if (opcoes.documentosCompletos && p.documentoCifrado) {
          const claro = cofre.decifrar(p.documentoCifrado);
          documento = p.documentoTipo === "CPF" ? formatarCpf(claro) : claro;
        }
        return {
          id: p.id,
          nome: p.nome,
          categoria: p.categoria,
          documentoTipo: p.documentoTipo,
          documento,
          documentoValido: p.documentoValido,
          embarque: p.embarque,
          pontoEmbarqueId: p.pontoEmbarqueId,
        };
      }),
  }));

  const duplicatas = detectarDuplicatas(
    listaReservas
      .filter((r) => r.status === "CONFIRMADA")
      .map((r) => ({
        id: r.id,
        canal: r.canal,
        canalOrigem: r.canalOrigem,
        codigoExterno: r.codigoExterno,
        referencias: r.referencias,
        contatoNome: r.contatoNome,
        categorias: listaPassageiros.filter((p) => p.reservaId === r.id).map((p) => p.categoria),
      })),
  );

  const manifesto: Manifesto = montarManifesto(
    pontos.filter((p) => p.ativo),
    reservasManifesto,
    {
      capacidade: linha.saida.capacidade,
      minimoConfirmacao: linha.passeio.minimoConfirmacao,
      minimoSupervisor: linha.passeio.minimoSupervisor,
      documentoObrigatorio: false,
    },
    duplicatas,
  );

  return { saida: linha.saida, passeio: linha.passeio, manifesto };
}

/** CSV (separador ";", UTF-8 com BOM) para abrir no Excel. */
export function manifestoCsv(m: Manifesto): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    // Evita injeção de fórmula ao abrir no Excel.
    const seguro = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[;"\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
  };
  const linhas = [["Nº", "Horário", "Ponto de embarque", "Passageiro", "Categoria", "Tipo doc.", "Documento", "Titular", "Canal", "Código", "Embarque"]];
  for (const b of m.blocos) {
    for (const l of b.linhas) {
      linhas.push([
        String(l.numero), b.ponto?.horario ?? "", b.ponto?.nome ?? "A DEFINIR", l.passageiro.nome || "(a informar)",
        l.passageiro.categoria, l.passageiro.documentoTipo ?? "", l.passageiro.documento ?? "", l.contatoNome,
        l.canal, l.codigoExterno ?? "", l.passageiro.embarque,
      ]);
    }
  }
  return "﻿" + linhas.map((l) => l.map(esc).join(";")).join("\r\n") + "\r\n";
}
