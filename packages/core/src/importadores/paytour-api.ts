import { canalPorDocumentoFicticio, somenteDigitos } from "../documento.js";
import { extrairReferenciasOta } from "../dedupe.js";
import { categoriaPorRotulo, type ReservaImportada } from "./comum.js";
import { MAX_PASSAGEIROS_POR_RESERVA } from "./bokun-email.js";
import { canalVendaPaytour, dataHoraBrasiliaParaUtc, ratearCentavos, reaisParaCentavos, type VendaImportada } from "../vendas/vendas.js";
import { canalPorAfiliado, tipoDocumentoPorValor } from "./paytour-csv.js";

/**
 * Pedido da API v2 da Paytour (GET /pedidos?includeItems=1&includeObs=1 ou GET /pedidos/{id}).
 * Só os campos que o sistema usa; a API manda muitos outros (pagamento, UTM…), que são ignorados.
 * Campos vêm como texto ("1", "null") — por isso a leitura é tolerante.
 */
export interface PedidoPaytour {
  id: string | number;
  status?: string | null;
  cliente_nome?: string | null;
  cliente_email?: string | null;
  cliente_cpf?: string | null;
  cliente_celular?: string | null;
  cliente_telefone?: string | null;
  cliente_ddi?: string | null;
  afiliado_id?: string | number | null;
  /** Ex.: "civitatis" nos pedidos que a Civitatis manda pela integração nativa (metodo_pagamento "integracao_parceiro"). */
  tipo_pagamento?: string | null;
  metodo_pagamento?: string | null;
  metodo_pagamento_externo?: string | null;
  pagamento_pendente?: string | number | null;
  pagamento_pendente_pago_em?: string | null;
  cliente_uf?: string | null;
  cliente_pais?: string | null;
  cliente_estrangeiro?: string | number | null;
  /** Valores do pedido, em reais como texto ("170.00"). */
  valor?: string | number | null;
  desconto?: string | number | null;
  cupom_id?: string | number | null;
  parcelas_pagamento?: string | number | null;
  data_hora_pedido?: string | null;
  operador_id?: string | number | null;
  afiliado_comissao?: string | number | null;
  parceiro_id?: string | number | null;
  parceiro_comissao?: string | number | null;
  pagamento_pendente_valor?: string | number | null;
  cliente_cidade?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  pagamento_detalhes?: { subtotal?: string | number | null } | null;
  observacao?: string | null;
  data_hora_atualizacao?: string | null;
  itens?: ItemPedidoPaytour[] | null;
  observacoes?: Array<{ observacao?: string | null }> | null;
}

export interface ItemPedidoPaytour {
  id: string | number;
  produto_tipo?: string | null;
  /** Valor da linha do item, em reais. [A CONFIRMAR] se é o total da linha ou o unitário (usado só como peso do rateio). */
  valor?: string | number | null;
  opcionais?: Array<{ valor?: string | number | null; desconto_cupom?: string | number | null }> | null;
  quantidade?: string | number | null;
  nome_produto?: string | null;
  nome_utilizador?: string | null;
  produto_disponibilidade_data?: string | null;
  /** Rótulo do horário ("O dia todo", "Noite"…). */
  produto_disponibilidade_hora?: string | null;
  /** Horário de início "HH:MM:SS" (vem nulo em passeios de horário único). */
  produto_disponibilidade_hora_de?: string | null;
  data_utilizacao?: string | null;
  produto_faixa_etaria_nome?: string | null;
  voucher_code?: string | null;
  formulario?: Array<{ chave?: string | null; valor?: string | null; label?: string | null; tipo?: string | null; valor_formatado?: string | null }> | Record<string, unknown> | null;
}

/** "null", "" e null viram null. */
const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "null" ? null : s;
};
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Status que significam pedido desfeito. Vistos na Paytour da By Bus: aprovado, cancelado, reprovado (pagamento recusado). */
const STATUS_CANCELADO = /cancel|estorn|reembols|recusad|reprovad|expirad|chargeback|devolvid/;
const STATUS_CONFIRMADO = /aprovad|pago|confirmad|conclu/;

type CampoFormulario = { chave: string; label: string; tipo: string; valor: string };

/** O formulário pode vir como lista ou como objeto { chave: { valor, tipo, ... } }. */
function camposFormulario(f: ItemPedidoPaytour["formulario"]): CampoFormulario[] {
  if (!f) return [];
  const lista = Array.isArray(f)
    ? f
    : Object.entries(f).map(([chave, v]) => (typeof v === "object" && v ? { chave, ...(v as object) } : { chave, valor: v }));
  return lista.flatMap((c) => {
    const campo = c as Record<string, unknown>;
    const valor = texto(campo.valor_formatado) ?? texto(campo.valor);
    if (!valor) return [];
    // Pedidos antigos usam chaves com hífen ("nome-completo"); os novos, com sublinhado ("nome_completo").
    const chave = normalizar(String(campo.chave ?? "")).replace(/[-\s]+/g, "_");
    return [{ chave, label: normalizar(String(campo.label ?? "")), tipo: normalizar(String(campo.tipo ?? "")), valor }];
  });
}

/** Procura no formulário o primeiro campo cujo nome técnico, rótulo ou tipo combina. [A CONFIRMAR] nomes reais dos campos da By Bus. */
function campo(campos: CampoFormulario[], padrao: RegExp): string | null {
  return campos.find((c) => padrao.test(c.chave) || padrao.test(c.label) || padrao.test(c.tipo))?.valor ?? null;
}
const PADRAO_NOME = /nome_completo|^nome$|^nome do passageiro$/;
const PADRAO_DOCUMENTO = /cpf|documento|passaporte|\brg\b|identidade|dni/;
/** Em ordem de prioridade: o campo de embarque vale mais que o de hotel/estada do cliente. */
const PADROES_PONTO = [/embarque/, /ponto|encontro|pick ?up/, /hospedagem|local/];
/** Resposta de "ciente" num campo cujo nome já é o local (ex.: chave "embarque_as_18h30_no_ponto_de_taxi_do_villa_romana_shopping"). */
const RESPOSTA_CIENTE = /^(sim|ok|yes|s|x|1|true|ciente|confirmo|de acordo|concordo)$/i;

function pontoDoFormulario(campos: CampoFormulario[]): string | null {
  for (const padrao of PADROES_PONTO) {
    const c = campos.find((x) => padrao.test(x.chave) || padrao.test(x.label) || (padrao.source.includes("hospedagem") && x.tipo === "hospedagem"));
    if (c) return RESPOSTA_CIENTE.test(c.valor.trim()) ? (c.label || c.chave.replace(/_/g, " ")) : c.valor;
  }
  return null;
}

const temMarca = (v: unknown, marca: RegExp) => typeof v === "string" && marca.test(v.toLowerCase());
function ehIntegracaoCivitatis(p: PedidoPaytour): boolean {
  return temMarca(p.tipo_pagamento, /civitatis/) || (temMarca(p.metodo_pagamento, /integracao_parceiro/) && temMarca(p.cliente_email, /civitatis/));
}

/**
 * Canal de origem pelos rastros no pedido: integração Civitatis (tipo de pagamento) ou e-mail de
 * retransmissão do canal no cadastro do cliente (ex.: ...@expmessaging.tripadvisor.com, ...@decolar.com).
 */
function canalPorMarcas(p: PedidoPaytour): ReservaImportada["canal"] | null {
  if (ehIntegracaoCivitatis(p) || temMarca(p.cliente_email, /civitatis/)) return "CIVITATIS";
  if (temMarca(p.cliente_email, /tripadvisor|viator/)) return "VIATOR";
  if (temMarca(p.cliente_email, /decolar|despegar/)) return "DECOLAR";
  return null;
}

/**
 * Pagamento pelo método da Paytour (vistos nos pedidos da By Bus: pagamento_no_dia, cielo, zoop_pix,
 * pagamento_externo, cortesia, integracao_parceiro). [A CONFIRMAR] se "pagamento_externo" é sempre pago antes do passeio.
 */
export function pagamentoPaytour(p: PedidoPaytour, canal: ReservaImportada["canal"]): Pick<ReservaImportada, "pagamento" | "formaPagamento"> {
  const metodo = (texto(p.metodo_pagamento) ?? "").toLowerCase();
  const externo = (texto(p.metodo_pagamento_externo) ?? "").toLowerCase();
  const pendente = String(p.pagamento_pendente ?? "") === "1" && !texto(p.pagamento_pendente_pago_em);
  if (canal === "VIATOR") return { pagamento: "PAGO", formaPagamento: "Pago na Viator" };
  if (canal === "DECOLAR") return { pagamento: "PAGO", formaPagamento: "Pago na Decolar" };
  if (canal === "CIVITATIS") return { pagamento: "PAGO", formaPagamento: "Pago na Civitatis" };
  if (metodo === "cortesia") return { pagamento: "CORTESIA", formaPagamento: "Cortesia" };
  if (metodo === "pagamento_no_dia") return { pagamento: "A_PAGAR", formaPagamento: externo === "dinheiro" ? "Pagar no dia (dinheiro)" : "Pagar no dia" };
  if (pendente) return { pagamento: "A_PAGAR", formaPagamento: "Saldo a pagar" };
  const formas: Record<string, string> = { cielo: "Cartão", zoop_pix: "Pix", pix: "Pix", integracao_parceiro: "Pago no parceiro" };
  if (formas[metodo]) return { pagamento: "PAGO", formaPagamento: formas[metodo] };
  if (metodo === "pagamento_externo") {
    const ext: Record<string, string> = { cartao_credito: "Cartão (fora do site)", dinheiro: "Dinheiro (fora do site)", outros: "Outros (fora do site)" };
    return { pagamento: "PAGO", formaPagamento: ext[externo] ?? "Pago fora do site" };
  }
  return { pagamento: null, formaPagamento: null };
}

/** Origem do cliente: país (estrangeiro) ou UF (Brasil). */
function origemPaytour(p: PedidoPaytour): string | null {
  const pais = texto(p.cliente_pais)?.toUpperCase() ?? null;
  const estrangeiro = String(p.cliente_estrangeiro ?? "0") === "1" || (pais !== null && !["BRA", "BR", "BRASIL"].includes(pais));
  if (estrangeiro) return pais;
  return texto(p.cliente_uf)?.toUpperCase() ?? null;
}

/** "08:00", "08:00 até 10:00", "8h" → "08:00" */
function horarioInicial(t: string | null): string | null {
  const m = t ? /(\d{1,2})[:h](\d{2})?/.exec(t) : null;
  return m ? `${m[1]!.padStart(2, "0")}:${m[2] ?? "00"}` : null;
}

/**
 * Converte um pedido da Paytour em reservas do sistema: uma por passeio e dia do pedido
 * (um pedido pode ter vários passeios). Cada item é uma faixa etária com `quantidade` pessoas;
 * nomes e documentos vêm do formulário inteligente quando preenchido.
 *
 * `codigoExterno` = "PAYTOUR-<id do pedido>" (o mesmo da importação por CSV, para não duplicar);
 * com mais de um passeio/dia no pedido, ganha o sufixo "-<data>-<n>".
 */
/** "City Tour Toda Ilha" → "city-tour-toda-ilha" (parte estável do código de reservas com vários itens). */
export const slugProduto = (produto: string) =>
  produto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "produto";

export function pedidoPaytourParaReservas(pedido: PedidoPaytour, afiliados: Record<string, string> = {}): ReservaImportada[] {
  const id = String(pedido.id);
  const status = normalizar(texto(pedido.status) ?? "");
  const cancelada = STATUS_CANCELADO.test(status);
  const obs = [texto(pedido.observacao), ...(pedido.observacoes ?? []).map((o) => texto(o.observacao))].filter((o): o is string => !!o).join(" | ") || null;
  const afiliado = afiliados[String(pedido.afiliado_id ?? "")] ?? "";
  const telefone = texto(pedido.cliente_celular) ?? texto(pedido.cliente_telefone);
  const ddi = texto(pedido.cliente_ddi);

  const itens = (pedido.itens ?? []).filter((i) => (texto(i.produto_tipo) ?? "passeio") !== "produto");
  const grupos = new Map<string, ItemPedidoPaytour[]>();
  for (const item of itens) {
    const data = texto(item.produto_disponibilidade_data) ?? texto(item.data_utilizacao) ?? "";
    const chave = `${data}|${texto(item.nome_produto) ?? ""}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), item]);
  }

  const chaves = [...grupos.keys()].sort();

  // Valores: o pedido traz um total; ele é rateado entre as reservas (uma por data+passeio) pelo valor dos itens
  // (item + opcionais) e, sem valores nos itens, pela quantidade de pessoas. Só entram no rateio os grupos com data válida.
  const chavesValidas = chaves.filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.split("|")[0]!));
  const somaItens = (is: ItemPedidoPaytour[]) => is.reduce((t, i) => t + (reaisParaCentavos(i.valor) ?? 0) + (i.opcionais ?? []).reduce((o, x) => o + (reaisParaCentavos(x.valor) ?? 0), 0), 0);
  const pessoasDe = (is: ItemPedidoPaytour[]) => is.reduce((t, i) => t + Math.max(1, Number.parseInt(String(i.quantidade ?? "1"), 10) || 1), 0);
  const pesosValor = chavesValidas.map((c) => somaItens(grupos.get(c)!));
  const pesos = pesosValor.some((p) => p > 0) ? pesosValor : chavesValidas.map((c) => pessoasDe(grupos.get(c)!));
  const valorPedido = reaisParaCentavos(pedido.valor) ?? (pesosValor.some((p) => p > 0) ? pesosValor.reduce((t, p) => t + p, 0) : null);
  const descontoPedido = Math.max(0, reaisParaCentavos(pedido.desconto) ?? 0);
  const partesValor = valorPedido === null ? null : ratearCentavos(valorPedido, pesos);
  const partesDesconto = ratearCentavos(descontoPedido, pesos);
  const pendente = String(pedido.pagamento_pendente ?? "") === "1" && !texto(pedido.pagamento_pendente_pago_em);

  return chaves.flatMap((chave) => {
    const doGrupo = grupos.get(chave)!;
    const [data, produto] = chave.split("|") as [string, string];
    const avisos: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return [];
    if (!cancelada && !STATUS_CONFIRMADO.test(status)) avisos.push(`Pedido com status "${texto(pedido.status) ?? "sem status"}" na Paytour — conferir pagamento.`);

    const passageiros: ReservaImportada["passageiros"] = [];
    let ponto: string | null = null;
    let origemOta = canalPorAfiliado(afiliado) ?? canalPorMarcas(pedido);
    for (const item of doGrupo) {
      const campos = camposFormulario(item.formulario);
      ponto ??= pontoDoFormulario(campos);
      const faixa = texto(item.produto_faixa_etaria_nome);
      const categoria = faixa ? categoriaPorRotulo(faixa) ?? categoriaPorRotulo(faixa.split(/[\s-]/)[0] ?? faixa) : "ADULTO";
      if (faixa && !categoria) avisos.push(`Faixa etária "${faixa}" desconhecida, tratada como adulto.`);
      const documentoBruto = campo(campos, PADRAO_DOCUMENTO);
      origemOta ??= canalPorDocumentoFicticio(documentoBruto);
      const ficticio = !!canalPorDocumentoFicticio(documentoBruto);
      const nome = campo(campos, PADRAO_NOME) ?? texto(item.nome_utilizador) ?? "";
      const qtd = Math.max(1, Number.parseInt(String(item.quantidade ?? "1"), 10) || 1);
      for (let q = 0; q < qtd && passageiros.length < MAX_PASSAGEIROS_POR_RESERVA; q++) {
        passageiros.push({
          nome: q === 0 ? nome : "",
          categoria: categoria ?? "ADULTO",
          documentoTipo: q === 0 && documentoBruto && !ficticio ? tipoDocumentoPorValor(documentoBruto) : null,
          documento: q === 0 && documentoBruto && !ficticio ? documentoBruto : null,
        });
      }
    }
    if (passageiros.length >= MAX_PASSAGEIROS_POR_RESERVA) avisos.push(`Mais de ${MAX_PASSAGEIROS_POR_RESERVA} pessoas no pedido — conferir.`);
    const cpfCliente = texto(pedido.cliente_cpf);
    origemOta ??= canalPorDocumentoFicticio(cpfCliente);
    // Civitatis entra pela integração nativa da Paytour (é a venda original, não uma cópia manual).
    if (origemOta && !ehIntegracaoCivitatis(pedido)) avisos.push(`Reserva espelho de ${origemOta} lançada na Paytour.`);

    const canal = origemOta ?? "PAYTOUR";
    const posicao = chavesValidas.indexOf(chave);
    const venda: VendaImportada | null = valorPedido === null ? null : {
      pedidoCodigo: `PAYTOUR-${id}`,
      fonte: "PAYTOUR_API",
      canalVenda: canalVendaPaytour({ canalReserva: canal, afiliadoId: pedido.afiliado_id, parceiroId: pedido.parceiro_id, operadorId: pedido.operador_id, metodoPagamento: pedido.metodo_pagamento, metodoPagamentoExterno: pedido.metodo_pagamento_externo }),
      valorCentavos: valorPedido,
      subtotalCentavos: reaisParaCentavos(pedido.pagamento_detalhes?.subtotal) ?? valorPedido + descontoPedido,
      descontoCentavos: descontoPedido,
      cupomExternoId: texto(pedido.cupom_id),
      metodoPagamento: texto(pedido.metodo_pagamento),
      metodoPagamentoExterno: texto(pedido.metodo_pagamento_externo),
      tipoPagamento: texto(pedido.tipo_pagamento),
      parcelas: Number.parseInt(String(pedido.parcelas_pagamento ?? ""), 10) || null,
      dataHoraCompra: dataHoraBrasiliaParaUtc(texto(pedido.data_hora_pedido)),
      operadorId: texto(pedido.operador_id),
      afiliadoId: texto(pedido.afiliado_id),
      afiliadoComissaoCentavos: reaisParaCentavos(texto(pedido.afiliado_comissao)),
      parceiroId: texto(pedido.parceiro_id),
      parceiroComissaoCentavos: reaisParaCentavos(texto(pedido.parceiro_comissao)),
      pagamentoPendenteCentavos: pendente ? Math.max(0, reaisParaCentavos(texto(pedido.pagamento_pendente_valor)) ?? 0) : 0,
      utmSource: texto(pedido.utm_source),
      utmMedium: texto(pedido.utm_medium),
      utmCampaign: texto(pedido.utm_campaign),
      clienteCidade: texto(pedido.cliente_cidade),
    };
    return [{
      valorCentavos: partesValor && posicao >= 0 ? partesValor[posicao]! : null,
      descontoCentavos: posicao >= 0 ? partesDesconto[posicao]! : 0,
      venda,
      ...pagamentoPaytour(pedido, canal),
      origemCliente: origemPaytour(pedido),
      canal,
      // Estável quando o pedido ganha ou perde itens: depende da data e do produto, não da posição.
      // A importação reconhece a mesma reserva gravada antes com o código antigo (PAYTOUR-<id> ou PAYTOUR-<id>-<data>-<n>).
      codigoExterno: chaves.length > 1 ? `PAYTOUR-${id}-${data}-${slugProduto(produto)}` : `PAYTOUR-${id}`,
      referencias: [...new Set([...extrairReferenciasOta(obs), ...doGrupo.map((i) => texto(i.voucher_code)).filter((v): v is string => !!v)])],
      data,
      horario: horarioInicial(texto(doGrupo[0]!.produto_disponibilidade_hora_de) ?? texto(doGrupo[0]!.produto_disponibilidade_hora)),
      produto,
      contatoNome: texto(pedido.cliente_nome) ?? "",
      contatoTelefone: telefone ? (ddi && !telefone.startsWith("+") && somenteDigitos(ddi) !== "55" ? `${ddi} ${telefone}` : telefone) : null,
      contatoEmail: texto(pedido.cliente_email),
      pontoEmbarqueTexto: ponto,
      cancelada,
      observacoes: obs,
      passageiros,
      avisos,
    }];
  });
}
