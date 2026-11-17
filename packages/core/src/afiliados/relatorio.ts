import { dataBr, dataPorExtenso, type BlocoContrato } from "../grupos/contrato.js";
import { ROTULO_SITUACAO_COMISSAO, type SituacaoComissao } from "./comissao.js";

/** Uma linha do relatório (o mesmo que a tela de Comissões de afiliados mostra). */
export interface LinhaRelatorioComissao {
  afiliadoNome: string; pedidoCodigo: string | null; passeio: string; dataVenda: string | null; dataPasseio: string;
  valorReservaCentavos: number; comissaoCentavos: number; situacao: SituacaoComissao; dataPagamento: string | null;
  /** Afiliado que retém a comissão na venda e repassa o líquido (ex.: Inzama Travel). */
  retem?: boolean;
}

const reais = (c: number) => `${c < 0 ? "-" : ""}R$ ${Math.floor(Math.abs(c) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${String(Math.abs(c) % 100).padStart(2, "0")}`;
const CURTO: Record<SituacaoComissao, string> = { PREVISTA: "Prevista", A_PAGAR: "A pagar", PAGA: "Paga", RETIDA: "Retida", CANCELADA: "Cancelada" };
const SITUACOES: SituacaoComissao[] = ["A_PAGAR", "PREVISTA", "PAGA", "RETIDA", "CANCELADA"];

/**
 * Relatório de comissões em PDF (dono, 17/11/2026), no papel timbrado: período e critério, totais por situação, resumo por
 * afiliado e o detalhe de cada afiliado (reserva por reserva). As canceladas e "não compareceu" aparecem, com comissão zero no total.
 */
export function montarRelatorioComissoes(r: {
  de: string; ate: string; por: "PASSEIO" | "VENDA"; emitidoEm: string; cidade: string;
  afiliado?: string | null; situacao?: SituacaoComissao | null; itens: LinhaRelatorioComissao[];
}): BlocoContrato[] {
  const b: BlocoContrato[] = [{ tipo: "titulo", texto: "RELATÓRIO DE COMISSÕES DE AFILIADOS" }];
  const filtros = [
    `**Período:** ${dataBr(r.de)} a ${dataBr(r.ate)}, pela data ${r.por === "VENDA" ? "da venda" : "do passeio"}`,
    r.afiliado ? `**Afiliado:** ${r.afiliado}` : null,
    r.situacao ? `**Situação:** ${ROTULO_SITUACAO_COMISSAO[r.situacao]}` : null,
  ].filter(Boolean);
  b.push({ tipo: "paragrafo", texto: `${filtros.join(" · ")}.` });
  if (!r.itens.length) {
    b.push({ tipo: "paragrafo", texto: "Nenhuma comissão no período com esses filtros." });
    b.push({ tipo: "paragrafo", texto: `**${r.cidade}, ${dataPorExtenso(r.emitidoEm)}.**` });
    return b;
  }
  const valida = (s: SituacaoComissao) => s !== "CANCELADA";
  const soma = (l: LinhaRelatorioComissao[], f: (x: LinhaRelatorioComissao) => boolean) => l.filter(f).reduce((t, x) => t + x.comissaoCentavos, 0);

  b.push({ tipo: "clausula", texto: "TOTAIS" });
  b.push({
    tipo: "tabela",
    colunas: [{ titulo: "Situação", largura: 3 }, { titulo: "Reservas", largura: 1.2, direita: true }, { titulo: "Comissão", largura: 2, direita: true }],
    linhas: SITUACOES.filter((s) => r.itens.some((x) => x.situacao === s)).map((s) => {
      const l = r.itens.filter((x) => x.situacao === s);
      return [ROTULO_SITUACAO_COMISSAO[s], String(l.length), s === "CANCELADA" ? "—" : reais(soma(l, () => true))];
    }),
    total: ["Total (sem canceladas)", String(r.itens.filter((x) => valida(x.situacao)).length), reais(soma(r.itens, (x) => valida(x.situacao)))],
  });

  const porAfiliado = new Map<string, LinhaRelatorioComissao[]>();
  for (const x of r.itens) porAfiliado.set(x.afiliadoNome, [...(porAfiliado.get(x.afiliadoNome) ?? []), x]);
  const nomes = [...porAfiliado.keys()].sort((a, z) => soma(porAfiliado.get(z)!, (x) => valida(x.situacao)) - soma(porAfiliado.get(a)!, (x) => valida(x.situacao)) || a.localeCompare(z, "pt-BR"));

  if (nomes.length > 1) {
    b.push({ tipo: "clausula", texto: "POR AFILIADO" });
    b.push({
      tipo: "tabela",
      colunas: [{ titulo: "Afiliado", largura: 3.4 }, { titulo: "Reservas", largura: 1.1, direita: true }, { titulo: "Vendido", largura: 1.8, direita: true }, { titulo: "A pagar", largura: 1.5, direita: true }, { titulo: "Prevista", largura: 1.5, direita: true }, { titulo: "Paga", largura: 1.5, direita: true }, { titulo: "Retida", largura: 1.5, direita: true }],
      linhas: nomes.map((n) => {
        const l = porAfiliado.get(n)!.filter((x) => valida(x.situacao));
        return [porAfiliado.get(n)![0]!.retem ? `${n} *` : n, String(l.length), reais(l.reduce((t, x) => t + x.valorReservaCentavos, 0)), reais(soma(l, (x) => x.situacao === "A_PAGAR")), reais(soma(l, (x) => x.situacao === "PREVISTA")), reais(soma(l, (x) => x.situacao === "PAGA")), reais(soma(l, (x) => x.situacao === "RETIDA"))];
      }),
    });
    if (nomes.some((n) => porAfiliado.get(n)![0]!.retem)) b.push({ tipo: "paragrafo", texto: "* Afiliado que retém a comissão na venda e repassa o valor líquido à By Bus: a comissão aparece só para controle e não vai para o contas a pagar." });
  }

  for (const n of nomes) {
    const l = porAfiliado.get(n)!;
    b.push({ tipo: "clausula", texto: n.toUpperCase() });
    if (l[0]!.retem) {
      const retida = soma(l, (x) => valida(x.situacao));
      const vendido = l.filter((x) => valida(x.situacao)).reduce((t, x) => t + x.valorReservaCentavos, 0);
      b.push({ tipo: "paragrafo", texto: `**Negociação diferente:** este afiliado vende e já retém a comissão (${reais(retida)}), repassando o líquido à By Bus (${reais(vendido - retida)} de ${reais(vendido)} vendidos). Não gera conta a pagar.` });
    }
    b.push({
      tipo: "tabela",
      colunas: [
        { titulo: r.por === "VENDA" ? "Venda" : "Passeio", largura: 1.25 }, { titulo: "Pedido", largura: 1.6 }, { titulo: "Passeio", largura: 2.6 },
        { titulo: "Valor", largura: 1.35, direita: true }, { titulo: "Comissão", largura: 1.35, direita: true }, { titulo: "Situação", largura: 1.2 }, { titulo: "Pagamento", largura: 1.25 },
      ],
      linhas: l.map((x) => [
        dataBr((r.por === "VENDA" ? x.dataVenda : x.dataPasseio) ?? x.dataPasseio), x.pedidoCodigo ?? "—", x.passeio, reais(x.valorReservaCentavos),
        x.situacao === "CANCELADA" ? "—" : reais(x.comissaoCentavos), CURTO[x.situacao], x.situacao === "CANCELADA" || x.situacao === "RETIDA" || x.retem || !x.dataPagamento ? "—" : dataBr(x.dataPagamento),
      ]),
      total: ["Total", "", "", reais(l.filter((x) => valida(x.situacao)).reduce((t, x) => t + x.valorReservaCentavos, 0)), reais(soma(l, (x) => valida(x.situacao))), "", ""],
    });
  }
  b.push({ tipo: "paragrafo", texto: "Comissão calculada a partir do valor informado pela Paytour, rateada pelas reservas do pedido. Só gera comissão o passeio realizado com o cliente presente; cancelamento e não comparecimento não geram. Pagamento nos dias 01 e 16." });
  b.push({ tipo: "paragrafo", texto: `**${r.cidade}, ${dataPorExtenso(r.emitidoEm)}.**` });
  return b;
}
