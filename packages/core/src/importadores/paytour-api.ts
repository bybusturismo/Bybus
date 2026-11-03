import { canalPorDocumentoFicticio, somenteDigitos } from "../documento.js";
import { extrairReferenciasOta } from "../dedupe.js";
import { categoriaPorRotulo, type ReservaImportada } from "./comum.js";
import { MAX_PASSAGEIROS_POR_RESERVA } from "./bokun-email.js";
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
  observacao?: string | null;
  data_hora_atualizacao?: string | null;
  itens?: ItemPedidoPaytour[] | null;
  observacoes?: Array<{ observacao?: string | null }> | null;
}

export interface ItemPedidoPaytour {
  id: string | number;
  produto_tipo?: string | null;
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

/** Status que significam pedido desfeito. [A CONFIRMAR] a documentação só mostra "aprovado". */
const STATUS_CANCELADO = /cancel|estorn|reembols|recusad|expirad|chargeback|devolvid/;
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
    return [{ chave: normalizar(String(campo.chave ?? "")), label: normalizar(String(campo.label ?? "")), tipo: normalizar(String(campo.tipo ?? "")), valor }];
  });
}

/** Procura no formulário o primeiro campo cujo nome técnico, rótulo ou tipo combina. [A CONFIRMAR] nomes reais dos campos da By Bus. */
function campo(campos: CampoFormulario[], padrao: RegExp): string | null {
  return campos.find((c) => padrao.test(c.chave) || padrao.test(c.label) || padrao.test(c.tipo))?.valor ?? null;
}
const PADRAO_NOME = /nome_completo|^nome$|^nome do passageiro$/;
const PADRAO_DOCUMENTO = /cpf|documento|passaporte|\brg\b|identidade|dni/;
const PADRAO_PONTO = /embarque|ponto|hotel|hospedagem|local|encontro|pick ?up/;

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
  return chaves.flatMap((chave, n) => {
    const doGrupo = grupos.get(chave)!;
    const [data, produto] = chave.split("|") as [string, string];
    const avisos: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return [];
    if (!cancelada && !STATUS_CONFIRMADO.test(status)) avisos.push(`Pedido com status "${texto(pedido.status) ?? "sem status"}" na Paytour — conferir pagamento.`);

    const passageiros: ReservaImportada["passageiros"] = [];
    let ponto: string | null = null;
    let origemOta = canalPorAfiliado(afiliado);
    for (const item of doGrupo) {
      const campos = camposFormulario(item.formulario);
      ponto ??= campo(campos, PADRAO_PONTO);
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
    if (origemOta) avisos.push(`Reserva espelho de ${origemOta} lançada na Paytour.`);

    return [{
      canal: origemOta ?? "PAYTOUR",
      codigoExterno: chaves.length > 1 ? `PAYTOUR-${id}-${data}-${n + 1}` : `PAYTOUR-${id}`,
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
