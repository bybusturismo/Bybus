import {
  ALVO_APLICACAO, GRUPOS_CUSTO_VEICULO, ALVO_IGNORAR, ALVO_TRANSFERENCIA, CONTAS_PADRAO, ROTULO_COLUNA, classificar, extrairPlaca, lerPlanilhaFinanceira, montarDicionario, normalizarTexto, separarObs,
  type ColunaValor, type ObsSeparada,
} from "@bybus/core";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { Db } from "../db/cliente.js";
import { finCategorias, finContas, finExtratoLinhas, finFornecedores, finLancamentos, finPlanilhaPendencias, finSinonimos } from "../db/schema.js";
import type { Cofre } from "../seguranca/cripto.js";
import { ErroHttp, type UsuarioSessao } from "../seguranca/sessao.js";
import { filtroPraca, garantirPlano, garantirSinonimos, hojeSP, saldosDasContas, validarPracaDoRegistro, type Conta } from "./financeiro.js";

/** Mapeamento manual de uma combinação "GRUPO|CATEGORIA" não reconhecida: id da categoria, "TRANSFERENCIA" ou "IGNORAR". */
export type Mapeamentos = Record<string, string>;

export interface EntradaPlanilha {
  conteudo: string;
  unidadeId: string | null;
  mapeamentos: Mapeamentos;
}

type ColunaConta = ColunaValor | "APLICACAO";

interface ItemLancamento {
  chave: string;
  coluna: ColunaValor;
  linhaNumero: number;
  data: string;
  tipo: "PAGAR" | "RECEBER";
  aberto: boolean;
  categoriaId: string;
  categoriaNome: string;
  descricao: string;
  fornecedor: string;
  /** Valor devido (em "A pagar" + conta na mesma linha, o valor de "A pagar"). */
  valorCentavos: number;
  /** Valor efetivamente pago/recebido (só nos realizados); a diferença para o devido vira juros ou desconto. */
  pagoCentavos: number | null;
  veiculo: string | null;
  observacao: string | null;
  contato: ObsSeparada;
}
interface ItemTransferencia {
  chave: string;
  data: string;
  descricao: string;
  lados: Array<{ coluna: ColunaConta; valorCentavos: number; idUnico: string }>;
  pareada: boolean;
}
export interface ItemSaldo {
  coluna: ColunaValor;
  valorCentavos: number;
  data: string;
  aplicar: boolean;
  motivo: string | null;
  /** Quando a conta já tem saldo inicial: saldo calculado pelo sistema no início da data e a diferença (a conferir; nunca sobrescreve). */
  calculadoCentavos: number | null;
  divergenciaCentavos: number | null;
}
export interface ContaDaColuna {
  coluna: ColunaConta;
  nome: string;
  contaId: string | null;
  criar: boolean;
}
export interface Qualidade {
  dataInvalida: Array<{ linha: number; texto: string }>;
  mesDiferente: Array<{ linha: number; mes: string; data: string }>;
  anoFora: Array<{ linha: number; data: string }>;
  grupoVazio: number[];
  grafias: Array<{ canonico: string; variantes: Array<{ texto: string; qtd: number }> }>;
  duplicadas: Array<{ linhas: number[]; data: string; fornecedor: string; valorCentavos: number }>;
  pessoaFisica: number[];
  previstas: number;
  apagarSemConta: number;
  apagarDiferente: number;
}

export interface PlanoPlanilha {
  layout: "NOVO" | "ANTIGO";
  cabecalhoLinha: number;
  lancamentos: ItemLancamento[];
  transferencias: ItemTransferencia[];
  saldos: ItemSaldo[];
  contas: ContaDaColuna[];
  naoReconhecidos: Array<{ chave: string; grupo: string; categoria: string; qtd: number; totalCentavos: number }>;
  qualidade: Qualidade;
  avisos: string[];
  ignoradas: number;
  erros: Array<{ linha: number; motivo: string }>;
  jaExistentes: number;
  novos: { lancamentos: number; transferencias: number };
  entrada: EntradaPlanilha;
  /** Chaves "GRUPO|CATEGORIA" que a pessoa mapeou e que foram usadas nesta leitura. */
  mapeamentosUsados: Set<string>;
  /** Identificadores já gravados antes (idempotência); uso interno. */
  existentes: Set<string>;
  existentesT: Set<string>;
}

const sha = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 40);
const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

/** Quando o sinal não combina com a categoria (ex.: estorno), a contrapartida certa de cada categoria. */
const CONTRAPARTIDA: Record<string, string> = {
  DESP_DEVOLUCAO: "REC_DEVOLUCAO", REC_DEVOLUCAO: "DESP_DEVOLUCAO", DESP_EMPRESTIMO: "REC_EMPRESTIMO", DESP_EMPRESTIMO_TERRENO: "REC_EMPRESTIMO", REC_EMPRESTIMO: "DESP_EMPRESTIMO",
};

function contaDaColuna(coluna: ColunaConta, contas: Conta[]): Conta | null {
  const padrao = CONTAS_PADRAO.find((c) => c.chave === coluna);
  if (!padrao) return null;
  return contas.find((c) => c.ativa && normalizarTexto(c.nome).includes(padrao.chave)) ?? null;
}

/** Lê a planilha e monta o plano de importação (nada é gravado). */
export async function planejarPlanilha(db: Db, u: UsuarioSessao, entrada: EntradaPlanilha): Promise<PlanoPlanilha> {
  await validarPracaDoRegistro(db, u, entrada.unidadeId);
  let lida;
  try {
    lida = lerPlanilhaFinanceira(entrada.conteudo);
  } catch (e) {
    throw new ErroHttp(400, "PLANILHA_INVALIDA", (e as Error).message);
  }
  await garantirPlano(db);
  await garantirSinonimos(db);
  const dic = montarDicionario((await db.select().from(finSinonimos)).map((s) => ({ tipo: s.tipo as "GRUPO" | "CATEGORIA", texto: s.texto, alvo: s.alvo })));
  const cats = await db.select().from(finCategorias);
  const porCodigo = new Map(cats.map((c) => [c.codigo, c]));
  const porId = new Map(cats.map((c) => [c.id, c]));

  const todasContas = await db.select().from(finContas).where(filtroPraca(u, finContas.unidadeId));
  const daPraca = todasContas.filter((c) => (c.unidadeId ?? null) === (entrada.unidadeId ?? null));
  const colunasUsadas = new Set<ColunaConta>();
  for (const l of lida.linhas) for (const k of Object.keys(l.valores) as ColunaValor[]) colunasUsadas.add(k);
  colunasUsadas.delete("APAGAR");

  const avisos: string[] = [];
  if (lida.colunasNaoReconhecidas.length) avisos.push(`Colunas ignoradas: ${lida.colunasNaoReconhecidas.join(", ")}.`);
  avisos.push(lida.layout === "ANTIGO" ? "Layout antigo detectado (SAÍDA SIC e ENTR SIC positivos): o Sicredi é calculado como entrada − saída." : "Layout novo detectado (saídas negativas em cada conta).");
  avisos.push("O resumo do topo da planilha não é importado: o sistema recalcula tudo.");

  const hoje = hojeSP();
  const qualidade: Qualidade = { dataInvalida: lida.datasInvalidas, mesDiferente: [], anoFora: [], grupoVazio: [], grafias: [], duplicadas: [], pessoaFisica: [], previstas: 0, apagarSemConta: 0, apagarDiferente: 0 };
  const plano: PlanoPlanilha = {
    layout: lida.layout, cabecalhoLinha: lida.cabecalhoLinha, lancamentos: [], transferencias: [], saldos: [], contas: [], naoReconhecidos: [], qualidade, avisos, ignoradas: lida.ignoradas.length, erros: lida.erros,
    jaExistentes: 0, novos: { lancamentos: 0, transferencias: 0 }, entrada, mapeamentosUsados: new Set(), existentes: new Set(), existentesT: new Set(),
  };

  // ---------- qualidade dos dados (só aponta; nada é descartado)
  const comData = lida.linhas.filter((l) => !l.saldo && l.data);
  const anos = new Map<string, number>();
  for (const l of comData) anos.set(l.data!.slice(0, 4), (anos.get(l.data!.slice(0, 4)) ?? 0) + 1);
  const anoMaisComum = [...anos].sort((a, b) => b[1] - a[1])[0]?.[0];
  const variantes = new Map<string, Map<string, number>>();
  const vistos = new Map<string, number[]>();
  for (const l of comData) {
    if (anoMaisComum && l.data!.slice(0, 4) !== anoMaisComum) qualidade.anoFora.push({ linha: l.numero, data: l.data! });
    const mes = MESES.indexOf(normalizarTexto(l.mes).slice(0, 3));
    if (mes >= 0 && mes + 1 !== Number(l.data!.slice(5, 7))) qualidade.mesDiferente.push({ linha: l.numero, mes: l.mes, data: l.data! });
    if (!l.grupo.trim()) qualidade.grupoVazio.push(l.numero);
    else {
      const canon = dic.grupos.get(normalizarTexto(l.grupo)) ?? normalizarTexto(l.grupo);
      const v = variantes.get(canon) ?? new Map<string, number>();
      v.set(l.grupo, (v.get(l.grupo) ?? 0) + 1);
      variantes.set(canon, v);
    }
    if (/\bCPF\b/.test(normalizarTexto(`${l.categoria} ${l.fornecedor} ${l.descricao} ${l.obs}`))) qualidade.pessoaFisica.push(l.numero);
    for (const [coluna, v] of Object.entries(l.valores)) {
      const k = `${l.data}|${normalizarTexto(l.fornecedor)}|${coluna}|${v}`;
      vistos.set(k, [...(vistos.get(k) ?? []), l.numero]);
    }
  }
  for (const [canonico, v] of variantes) if (v.size > 1) qualidade.grafias.push({ canonico, variantes: [...v].map(([texto, qtd]) => ({ texto, qtd })) });
  for (const [k, linhas] of vistos) if (linhas.length > 1) {
    const [data, fornecedor, , valor] = k.split("|");
    qualidade.duplicadas.push({ linhas, data: data!, fornecedor: fornecedor!, valorCentavos: Math.abs(Number(valor)) });
  }
  if (qualidade.dataInvalida.length) avisos.push(`${qualidade.dataInvalida.length} linha(s) com data vazia ou inválida ficaram de fora; corrija a planilha e importe de novo.`);
  if (qualidade.pessoaFisica.length) avisos.push(`${qualidade.pessoaFisica.length} linha(s) citam CPF (cartão, consórcio ou conta de pessoa física): confira se são despesas pessoais, que ficam fora do resultado operacional.`);
  if (qualidade.duplicadas.length) avisos.push(`${qualidade.duplicadas.length} possível(is) duplicidade(s) (mesma data, favorecido, conta e valor). Podem ser lançamentos recorrentes legítimos (diárias, contratos mensais): verificar, nada foi descartado.`);

  const datas = comData.map((l) => l.data!).sort();
  const ocorrencias = new Map<string, number>();
  const pendentes = new Map<string, { grupo: string; categoria: string; qtd: number; total: number }>();
  let mudouSinal = 0;
  let aplicacaoUsada = false;

  for (const l of lida.linhas) {
    if (l.saldo) {
      for (const [coluna, v] of Object.entries(l.valores) as Array<[ColunaValor, number]>) {
        if (coluna === "APAGAR") continue;
        plano.saldos.push({ coluna, valorCentavos: v, data: l.data ?? datas[0] ?? "", aplicar: true, motivo: null, calculadoCentavos: null, divergenciaCentavos: null });
      }
      continue;
    }
    const cls = classificar(l.grupo, l.categoria, dic);
    let alvo = cls.alvo;
    if (!alvo) {
      const m = entrada.mapeamentos[cls.chave];
      if (m === "IGNORAR") alvo = ALVO_IGNORAR;
      else if (m === "TRANSFERENCIA") alvo = ALVO_TRANSFERENCIA;
      else if (m && porId.has(m)) alvo = porId.get(m)!.codigo;
      if (alvo) plano.mapeamentosUsados.add(cls.chave);
    }
    if (!alvo) {
      const x = pendentes.get(cls.chave) ?? { grupo: l.grupo, categoria: l.categoria, qtd: 0, total: 0 };
      x.qtd += 1;
      x.total += Object.values(l.valores).reduce((s, v) => s + Math.abs(v ?? 0), 0);
      pendentes.set(cls.chave, x);
      continue;
    }
    if (alvo === ALVO_IGNORAR) { plano.ignoradas += 1; continue; }
    const base = [normalizarTexto(l.grupo), normalizarTexto(l.categoria), normalizarTexto(l.fornecedor), normalizarTexto(l.descricao), l.data].join("|");
    const lados = (Object.entries(l.valores) as Array<[ColunaValor, number]>).filter(([c]) => c !== "APAGAR");

    if (alvo === ALVO_TRANSFERENCIA || alvo === ALVO_APLICACAO) {
      if (lados.length < Object.keys(l.valores).length) avisos.push(`Linha ${l.numero}: valor em "A pagar" numa transferência ou aplicação foi ignorado.`);
      if (lados.length === 0) continue;
      const aplic = alvo === ALVO_APLICACAO;
      const k = `${aplic ? "A" : "T"}|${base}|${lados.map(([c, v]) => `${c}:${v}`).join(",")}`;
      const ordem = (ocorrencias.get(k) ?? 0) + 1;
      ocorrencias.set(k, ordem);
      const chave = sha(`${k}|${ordem}`);
      let ladosFinal: Array<{ coluna: ColunaConta; valorCentavos: number }> = lados.map(([coluna, valorCentavos]) => ({ coluna, valorCentavos }));
      if (aplic) {
        // Aplicação e resgate: a outra ponta é a conta Aplicação (investimento), com o valor oposto.
        aplicacaoUsada = true;
        ladosFinal = ladosFinal.flatMap((x) => [x, { coluna: "APLICACAO" as const, valorCentavos: -x.valorCentavos }]);
      }
      const pareada = aplic || (ladosFinal.length === 2 && ladosFinal[0]!.valorCentavos === -ladosFinal[1]!.valorCentavos);
      if (!pareada) avisos.push(`Linha ${l.numero}: transferência sem a outra ponta; fica como transferência sem par.`);
      plano.transferencias.push({
        chave, data: l.data!, descricao: (l.descricao || l.categoria || (aplic ? "Aplicação/resgate" : "Transferência")).slice(0, 200), pareada,
        lados: ladosFinal.map((x) => ({ ...x, idUnico: `planilha:${chave}:${x.coluna}:${x.valorCentavos}` })),
      });
      continue;
    }

    const cat = porCodigo.get(alvo);
    if (!cat) { avisos.push(`Linha ${l.numero}: a categoria "${alvo}" do dicionário não existe.`); continue; }
    const obs = separarObs(l.obs);
    const veiculo = GRUPOS_CUSTO_VEICULO.includes(cat.grupo) ? extrairPlaca(`${l.descricao} ${l.fornecedor} ${obs.texto}`) : null;
    const novo = (coluna: ColunaValor, tipo: "PAGAR" | "RECEBER", aberto: boolean, devido: number, pago: number | null): ItemLancamento => {
      let categoria = cat;
      if ((tipo === "PAGAR") !== (cat.tipo === "DESPESA")) {
        mudouSinal += 1;
        categoria = porCodigo.get(CONTRAPARTIDA[cat.codigo] ?? (tipo === "PAGAR" ? "DESP_DEVOLUCAO" : "REC_OUTRAS")) ?? cat;
      }
      const k = `L|${coluna}|${tipo}|${devido}|${pago}|${base}`;
      const ordem = (ocorrencias.get(k) ?? 0) + 1;
      ocorrencias.set(k, ordem);
      return {
        chave: sha(`${k}|${ordem}`), coluna, linhaNumero: l.numero, data: l.data!, tipo, aberto, categoriaId: categoria.id, categoriaNome: categoria.nome,
        descricao: (l.descricao || categoria.nome).slice(0, 200), fornecedor: l.fornecedor.slice(0, 150), valorCentavos: devido, pagoCentavos: pago, veiculo,
        observacao: obs.texto ? obs.texto.slice(0, 500) : null, contato: obs,
      };
    };

    const apagar = l.valores.APAGAR;
    if (apagar !== undefined && lados.length === 1 && lados[0]![1] < 0) {
      // "A pagar" e a conta na mesma linha = a conta foi paga; se o valor pago difere do devido, a diferença é juros ou desconto.
      const [coluna, v] = lados[0]!;
      const item = novo(coluna, "PAGAR", false, Math.abs(apagar), Math.abs(v));
      if (item.valorCentavos !== item.pagoCentavos) qualidade.apagarDiferente += 1;
      plano.lancamentos.push(item);
      continue;
    }
    for (const [coluna, v] of Object.entries(l.valores) as Array<[ColunaValor, number]>) {
      const aberto = coluna === "APAGAR";
      const tipo: "PAGAR" | "RECEBER" = aberto || v < 0 ? "PAGAR" : "RECEBER";
      const item = novo(coluna, tipo, aberto, Math.abs(v), aberto ? null : Math.abs(v));
      if (aberto) { if (lados.length === 0) qualidade.apagarSemConta += 1; if (l.data! > hoje) qualidade.previstas += 1; }
      plano.lancamentos.push(item);
    }
  }
  if (mudouSinal) avisos.push(`${mudouSinal} lançamento(s) tinham sinal diferente do esperado para a categoria e foram para a contrapartida (devoluções, empréstimo tomado ou outras receitas).`);
  if (qualidade.apagarDiferente) avisos.push(`${qualidade.apagarDiferente} conta(s) com valor pago diferente do "A pagar": a diferença foi registrada como juros ou desconto.`);
  plano.naoReconhecidos = [...pendentes].map(([chave, x]) => ({ chave, grupo: x.grupo, categoria: x.categoria, qtd: x.qtd, totalCentavos: x.total }));

  // Contas das colunas usadas (e a Aplicação, quando há aplicação/resgate).
  if (aplicacaoUsada) colunasUsadas.add("APLICACAO");
  plano.contas = [...colunasUsadas].map((coluna) => {
    const c = contaDaColuna(coluna, daPraca);
    return { coluna, nome: c?.nome ?? CONTAS_PADRAO.find((p) => p.chave === coluna)?.nome ?? ROTULO_COLUNA[coluna as ColunaValor], contaId: c?.id ?? null, criar: !c };
  });

  // Já existentes (idempotência): reimportar a mesma aba não duplica.
  const chaves = plano.lancamentos.map((i) => i.chave);
  for (let i = 0; i < chaves.length; i += 1000) {
    const r = await db.select({ c: finLancamentos.chaveImportacao }).from(finLancamentos).where(inArray(finLancamentos.chaveImportacao, chaves.slice(i, i + 1000)));
    for (const x of r) if (x.c) plano.existentes.add(x.c);
  }
  const idsT = plano.transferencias.flatMap((t) => t.lados.map((x) => x.idUnico));
  for (let i = 0; i < idsT.length; i += 1000) {
    const r = await db.select({ c: finExtratoLinhas.idUnico }).from(finExtratoLinhas).where(inArray(finExtratoLinhas.idUnico, idsT.slice(i, i + 1000)));
    for (const x of r) plano.existentesT.add(x.c);
  }
  const novosL = plano.lancamentos.filter((i) => !plano.existentes.has(i.chave));
  const novasT = plano.transferencias.filter((t) => !t.lados.every((x) => plano.existentesT.has(x.idUnico)));
  plano.jaExistentes = plano.lancamentos.length - novosL.length + plano.transferencias.length - novasT.length;
  plano.novos = { lancamentos: novosL.length, transferencias: novasT.length };

  // Saldos ("AAA SALDO"): a primeira importação define o saldo inicial; nas seguintes, compara com o saldo calculado e mostra a divergência (nunca sobrescreve).
  for (const s of plano.saldos) {
    const conta = contaDaColuna(s.coluna, daPraca);
    if (!s.data) { s.aplicar = false; s.motivo = "A linha de saldo não tem data e a planilha não tem lançamentos datados."; continue; }
    if (!conta || !conta.saldoInicialEm) continue;
    s.aplicar = false;
    if (s.data < conta.saldoInicialEm) { s.motivo = `Anterior ao saldo inicial já cadastrado (${conta.saldoInicialEm.split("-").reverse().join("/")}); não foi comparado.`; continue; }
    const calculado = (await saldosDasContas(db, [conta], s.data)).get(conta.id) ?? 0;
    s.calculadoCentavos = calculado;
    s.divergenciaCentavos = s.valorCentavos - calculado;
    s.motivo = s.divergenciaCentavos === 0 ? "Confere com o saldo calculado pelo sistema." : "Diverge do saldo calculado pelo sistema: conferir. O saldo cadastrado não foi alterado.";
  }
  return plano;
}

export interface ResultadoImportacao {
  lancamentos: number;
  transferencias: number;
  jaExistentes: number;
  contasCriadas: string[];
  saldosAplicados: number;
  fornecedores: number;
  sinonimosSalvos: number;
}

/** Grava o plano (tudo numa transação). Nada de CPF/CNPJ/e-mail/telefone vai para descrição, log ou auditoria. */
export async function executarPlanilha(db: Db, cofre: Cofre, u: UsuarioSessao, plano: PlanoPlanilha, opcoes: { salvarSinonimos: boolean }): Promise<ResultadoImportacao> {
  const { existentes, existentesT } = plano;
  const unidadeId = plano.entrada.unidadeId;
  return db.transaction(async (tx) => {
    const idConta = new Map<ColunaConta, string>();
    const criadas: string[] = [];
    for (const c of plano.contas) {
      if (c.contaId) { idConta.set(c.coluna, c.contaId); continue; }
      const padrao = CONTAS_PADRAO.find((p) => p.chave === c.coluna)!;
      const [nova] = await tx.insert(finContas).values({ nome: padrao.nome, tipo: padrao.tipo, unidadeId }).returning({ id: finContas.id });
      idConta.set(c.coluna, nova!.id);
      criadas.push(padrao.nome);
    }
    let saldosAplicados = 0;
    for (const s of plano.saldos) {
      if (!s.aplicar) continue;
      const id = idConta.get(s.coluna);
      if (!id) continue;
      await tx.update(finContas).set({ saldoInicialCentavos: s.valorCentavos, saldoInicialEm: s.data }).where(eq(finContas.id, id));
      saldosAplicados += 1;
    }

    // Fornecedores (favorecidos) com contatos cifrados, só dos lançamentos novos.
    const novos = plano.lancamentos.filter((i) => !existentes.has(i.chave));
    const porNome = new Map<string, { nome: string; contato: ObsSeparada }>();
    for (const i of novos) {
      const n = normalizarTexto(i.fornecedor);
      if (!n) continue;
      const atual = porNome.get(n) ?? { nome: i.fornecedor, contato: { texto: "", documentos: [], emails: [], telefones: [] } };
      atual.contato.documentos.push(...i.contato.documentos);
      atual.contato.emails.push(...i.contato.emails);
      atual.contato.telefones.push(...i.contato.telefones);
      porNome.set(n, atual);
    }
    const idsFornecedor = new Map<string, string>();
    if (porNome.size) {
      const atuais = await tx.select().from(finFornecedores).where(inArray(finFornecedores.nomeNormalizado, [...porNome.keys()]));
      for (const [n, f] of porNome) {
        const existente = atuais.find((a) => a.nomeNormalizado === n);
        const novo = { documentos: [...new Set(f.contato.documentos)], emails: [...new Set(f.contato.emails)], telefones: [...new Set(f.contato.telefones)] };
        const temContato = novo.documentos.length + novo.emails.length + novo.telefones.length > 0;
        if (existente) {
          idsFornecedor.set(n, existente.id);
          if (temContato) {
            const antigo = existente.contatoCifrado ? (JSON.parse(cofre.decifrar(existente.contatoCifrado)) as typeof novo) : { documentos: [], emails: [], telefones: [] };
            const junto = { documentos: [...new Set([...antigo.documentos, ...novo.documentos])], emails: [...new Set([...antigo.emails, ...novo.emails])], telefones: [...new Set([...antigo.telefones, ...novo.telefones])] };
            await tx.update(finFornecedores).set({ contatoCifrado: cofre.cifrar(JSON.stringify(junto)) }).where(eq(finFornecedores.id, existente.id));
          }
        } else {
          const [criado] = await tx.insert(finFornecedores).values({ nome: f.nome, nomeNormalizado: n, contatoCifrado: temContato ? cofre.cifrar(JSON.stringify(novo)) : null }).returning({ id: finFornecedores.id });
          idsFornecedor.set(n, criado!.id);
        }
      }
    }

    let gravados = 0;
    for (let i = 0; i < novos.length; i += 500) {
      const lote = novos.slice(i, i + 500).map((x) => {
        const pago = x.aberto ? null : x.pagoCentavos ?? x.valorCentavos;
        const diferenca = pago === null ? 0 : pago - x.valorCentavos;
        return {
          tipo: x.tipo, descricao: x.descricao, contraparte: x.fornecedor || null, categoriaId: x.categoriaId, contaId: x.aberto ? null : idConta.get(x.coluna) ?? null, unidadeId,
          veiculo: x.veiculo, valorCentavos: x.valorCentavos, competencia: x.data, vencimento: x.data,
          situacao: x.aberto ? "ABERTO" : "REALIZADO", pagoEm: x.aberto ? null : x.data, valorPagoCentavos: pago,
          jurosCentavos: diferenca > 0 ? diferenca : 0, descontoCentavos: diferenca < 0 ? -diferenca : 0,
          observacao: x.observacao, origem: "PLANILHA", fornecedorId: idsFornecedor.get(normalizarTexto(x.fornecedor)) ?? null, chaveImportacao: x.chave, criadoPor: u.id,
        };
      });
      const r = await tx.insert(finLancamentos).values(lote).onConflictDoNothing().returning({ id: finLancamentos.id });
      gravados += r.length;
    }

    let transf = 0;
    for (const t of plano.transferencias) {
      if (t.lados.every((x) => existentesT.has(x.idUnico))) continue;
      const ids = t.lados.map(() => randomUUID());
      // Pares: transferência de 2 lados (um contra o outro); aplicação = cada lado com a ponta na conta Aplicação, na ordem [conta, aplicação].
      const par = (k: number) => (t.pareada ? (t.lados.length === 2 ? ids[1 - k]! : ids[k % 2 === 0 ? k + 1 : k - 1]!) : null);
      const linhas = t.lados.map((lado, k) => ({
        id: ids[k]!, contaId: idConta.get(lado.coluna)!, idUnico: lado.idUnico, data: t.data, valorCentavos: lado.valorCentavos, descricao: t.descricao,
        status: "TRANSFERENCIA", parLinhaId: par(k), manual: true, decididoPor: u.id, decididoEm: new Date(),
      })).filter((l, k) => !existentesT.has(t.lados[k]!.idUnico) && l.contaId);
      if (linhas.length) {
        await tx.insert(finExtratoLinhas).values(linhas).onConflictDoNothing();
        transf += 1;
      }
    }

    let sinonimos = 0;
    if (opcoes.salvarSinonimos) {
      const cats = await tx.select().from(finCategorias);
      for (const [chave, m] of Object.entries(plano.entrada.mapeamentos)) {
        const alvo = m === "IGNORAR" ? ALVO_IGNORAR : m === "TRANSFERENCIA" ? ALVO_TRANSFERENCIA : cats.find((c) => c.id === m)?.codigo;
        if (!alvo || !plano.mapeamentosUsados.has(chave)) continue;
        await tx.insert(finSinonimos).values({ tipo: "CATEGORIA", texto: chave, alvo }).onConflictDoUpdate({ target: [finSinonimos.tipo, finSinonimos.texto], set: { alvo } });
        sinonimos += 1;
      }
    }
    return { lancamentos: gravados, transferencias: transf, jaExistentes: plano.lancamentos.length - novos.length, contasCriadas: criadas, saldosAplicados, fornecedores: idsFornecedor.size, sinonimosSalvos: sinonimos };
  });
}

/** Cria as contas padrão (Sicredi, Unilos, Quiosque, Cartão, Aplicação) que ainda não existirem na praça. */
export async function criarContasPadrao(db: Db, u: UsuarioSessao, unidadeId: string | null): Promise<string[]> {
  await validarPracaDoRegistro(db, u, unidadeId);
  const existentes = (await db.select().from(finContas).where(filtroPraca(u, finContas.unidadeId))).filter((c) => (c.unidadeId ?? null) === (unidadeId ?? null));
  const criadas: string[] = [];
  for (const p of CONTAS_PADRAO) {
    if (contaDaColuna(p.chave as ColunaConta, existentes)) continue;
    await db.insert(finContas).values({ nome: p.nome, tipo: p.tipo, unidadeId });
    criadas.push(p.nome);
  }
  return criadas;
}

// ---------------------------------------------------------------- pendências de categoria (09/11/2026)

const hashAba = (conteudo: string, unidadeId: string | null) => createHash("sha256").update(`${unidadeId ?? "empresa"}|${conteudo}`).digest("hex");

/**
 * Depois de importar uma aba: o que ficou "não importar ainda" é guardado (aba cifrada) para classificar depois em
 * Financeiro › Pendências, sem importar de novo. Sem pendências, um registro anterior da mesma aba é dado como resolvido.
 */
export async function registrarPendencias(db: Db, cofre: Cofre, u: UsuarioSessao, entrada: { conteudo: string; unidadeId: string | null; arquivo: string | null }, plano: PlanoPlanilha) {
  const hash = hashAba(entrada.conteudo, entrada.unidadeId);
  const pendentes = plano.naoReconhecidos;
  if (!pendentes.length) {
    await db.update(finPlanilhaPendencias).set({ pendentes: [], conteudoCifrado: null, resolvidoEm: new Date(), atualizadoEm: new Date() }).where(eq(finPlanilhaPendencias.hash, hash));
    return 0;
  }
  const valores = { pendentes, conteudoCifrado: cofre.cifrar(entrada.conteudo), resolvidoEm: null, atualizadoEm: new Date(), arquivo: entrada.arquivo };
  await db.insert(finPlanilhaPendencias).values({ hash, unidadeId: entrada.unidadeId, criadoPor: u.id, ...valores })
    .onConflictDoUpdate({ target: finPlanilhaPendencias.hash, set: valores });
  return pendentes.reduce((s, p) => s + p.qtd, 0);
}

/** Pendências abertas (das praças do usuário), somadas por grupo › categoria. */
export async function listarPendencias(db: Db, u: UsuarioSessao) {
  const regs = await db.select().from(finPlanilhaPendencias).where(and(isNull(finPlanilhaPendencias.resolvidoEm), filtroPraca(u, finPlanilhaPendencias.unidadeId)));
  const porChave = new Map<string, { chave: string; grupo: string; categoria: string; qtd: number; totalCentavos: number; abas: number }>();
  for (const r of regs) for (const p of r.pendentes) {
    const x = porChave.get(p.chave) ?? { chave: p.chave, grupo: p.grupo, categoria: p.categoria, qtd: 0, totalCentavos: 0, abas: 0 };
    x.qtd += p.qtd; x.totalCentavos += p.totalCentavos; x.abas += 1;
    porChave.set(p.chave, x);
  }
  return {
    itens: [...porChave.values()].sort((a, b) => b.totalCentavos - a.totalCentavos),
    abas: regs.map((r) => ({ id: r.id, arquivo: r.arquivo, unidadeId: r.unidadeId, atualizadoEm: r.atualizadoEm, linhas: r.pendentes.reduce((s, p) => s + p.qtd, 0) })),
  };
}

/** Aplica as escolhas às abas guardadas: reprocessa cada aba com o mesmo importador (o que já entrou não duplica). */
export async function resolverPendencias(db: Db, cofre: Cofre, u: UsuarioSessao, mapeamentos: Mapeamentos, salvarSinonimos: boolean) {
  const regs = await db.select().from(finPlanilhaPendencias).where(and(isNull(finPlanilhaPendencias.resolvidoEm), filtroPraca(u, finPlanilhaPendencias.unidadeId)));
  const total = { lancamentos: 0, transferencias: 0, abas: 0, restantes: 0 };
  for (const r of regs) {
    if (!r.conteudoCifrado || !r.pendentes.some((p) => mapeamentos[p.chave])) { total.restantes += r.pendentes.reduce((s, p) => s + p.qtd, 0); continue; }
    const conteudo = cofre.decifrar(r.conteudoCifrado);
    const proprios = Object.fromEntries(Object.entries(mapeamentos).filter(([k]) => r.pendentes.some((p) => p.chave === k)));
    const plano = await planejarPlanilha(db, u, { conteudo, unidadeId: r.unidadeId, mapeamentos: proprios });
    if (plano.erros.length) { total.restantes += r.pendentes.reduce((s, p) => s + p.qtd, 0); continue; }
    const res = await executarPlanilha(db, cofre, u, plano, { salvarSinonimos });
    total.lancamentos += res.lancamentos; total.transferencias += res.transferencias; total.abas += 1;
    const resta = plano.naoReconhecidos;
    total.restantes += resta.reduce((s, p) => s + p.qtd, 0);
    await db.update(finPlanilhaPendencias).set(resta.length
      ? { pendentes: resta, atualizadoEm: new Date() }
      : { pendentes: [], conteudoCifrado: null, resolvidoEm: new Date(), atualizadoEm: new Date() }).where(eq(finPlanilhaPendencias.id, r.id));
  }
  return total;
}
