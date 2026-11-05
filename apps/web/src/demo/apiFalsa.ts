/**
 * MODO DEMONSTRAÇÃO — API simulada no navegador, com dados 100% fictícios.
 * Usa as mesmas regras do sistema (@bybus/core): ordem de embarque, alertas, deduplicação e importação.
 * Nada é enviado a servidor; tudo se perde ao recarregar a página.
 */
import {
  PONTOS_TODA_ILHA, detectarDuplicatas, documentoValido, formatarCpf, lerCsvPaytour, lerEmailBokun, mascararDocumento,
  montarManifesto, normalizarDocumento, textoConfirmacao, textoListaGrupo, type Canal, type Categoria, type ReservaImportada, type TipoDocumento,
} from "@bybus/core";

import { NAO, type Ctx } from "./comum";
import { rotearBiblioteca } from "./bibliotecaDemo";
import { rotearFinanceiro } from "./financeiroDemo";
import { rotearFrota } from "./frotaDemo";
import { rotearIa } from "./iaDemo";
import { rotearMarketing } from "./marketingDemo";
import { rotearRastreio } from "./rastreioDemo";
import { criarTransferDemo } from "./transferDemo";
import { criarWhatsappDemo } from "./whatsappDemo";

/** Catálogo de permissões (espelha apps/api/src/seguranca/permissoes.ts). */
const CATALOGO: Record<string, string> = {
  "usuarios:gerenciar": "Gerenciar usuários e perfis de acesso",
  "unidades:gerenciar": "Cadastrar e editar praças/unidades",
  "auditoria:ver": "Ver o histórico de auditoria",
  "pessoas:gerenciar": "Cadastrar e editar guias, motoristas e colaboradores",
  "pessoas:ver": "Consultar guias e motoristas (para escalar)",
  "produtos:gerenciar": "Cadastrar passeios/produtos (praça e linha de negócio)",
  "pontos:gerenciar": "Editar pontos de embarque",
  "saidas:gerenciar": "Criar saídas e editar veículo/equipe",
  "saidas:decidir": "Confirmar, cancelar ou encerrar saídas",
  "escala:gerenciar": "Montar a escala mensal e trocar guia/motorista",
  "reservas:editar": "Lançar e editar reservas e passageiros",
  "importacoes:executar": "Importar reservas (Bókun, Paytour)",
  "manifesto:ver": "Ver a lista de passageiros",
  "manifesto:documentos": "Ver documentos completos (CPF/passaporte)",
  "manifesto:contatos": "Ver telefones e e-mails dos clientes",
  "embarque:registrar": "Registrar embarque (embarcou, atrasado, não veio)",
  "frota:ver": "Consultar frota: veículos, documentos, manutenção, abastecimento e painel",
  "frota:gerenciar": "Cadastrar veículos, documentos, planos, ordens de manutenção, abastecimentos e km",
  "frota:checklist": "Preencher o checklist diário do veículo (motorista)",
  "rastreio:transmitir": "Transmitir a posição do ônibus pelo celular (motorista da saída)",
  "marketing:ver": "Ver os painéis de marketing (canais, origem dos clientes, campanhas, avaliações, afiliados)",
  "marketing:gerenciar": "Gerenciar campanhas, calendário de conteúdo, avaliações e afiliados",
  "biblioteca:ver": "Ler as páginas da Biblioteca (manuais e procedimentos)",
  "biblioteca:editar": "Criar e editar páginas da Biblioteca, inclusive as restritas",
  "ia:usar": "Conversar com o assistente de IA (Turistinha)",
  "ia:gestores": "Ver os gestores de IA, rodar a avaliação e aprovar ou descartar ações sugeridas",
  "financeiro:ver": "Ver o financeiro (contas a pagar e a receber, extratos, DRE)",
  "financeiro:gerenciar": "Lançar, baixar, importar extratos e conciliar no financeiro",
  "whatsapp:ver": "Ver as conversas de WhatsApp com os clientes (telefones e textos)",
  "whatsapp:responder": "Responder e iniciar conversas de WhatsApp pela tela",
  "transfer:gerenciar": "Montar e ajustar o transfer do dia (ordem de busca, horários, van, motorista, taxa) e configurar os bairros",
  "transfer:operar": "Operar o transfer pelo celular (motorista): marcar buscado/não apareceu e registrar a taxa recebida",
};
const TODAS = Object.keys(CATALOGO);
const SENSIVEIS = ["usuarios:gerenciar", "unidades:gerenciar", "manifesto:documentos", "pessoas:gerenciar", "auditoria:ver", "ia:gestores", "financeiro:ver", "financeiro:gerenciar"];
interface PerfilDemo { id: string; codigo: string; nome: string; descricao: string | null; permissoes: string[]; sistema: boolean; criadoEm: string }
const perfis: PerfilDemo[] = [
  { codigo: "ADMIN", nome: "Administrador", descricao: "Acesso total, inclusive usuários, perfis e praças.", permissoes: TODAS },
  { codigo: "SUPERVISOR", nome: "Supervisor / líder", descricao: "Decide saídas, vê documentos completos, gerencia equipe e pontos.", permissoes: ["auditoria:ver", "pessoas:gerenciar", "pessoas:ver", "pontos:gerenciar", "saidas:gerenciar", "saidas:decidir", "escala:gerenciar", "reservas:editar", "importacoes:executar", "manifesto:ver", "manifesto:documentos", "manifesto:contatos", "embarque:registrar", "frota:ver", "frota:gerenciar", "marketing:ver", "biblioteca:ver", "ia:usar", "whatsapp:ver", "whatsapp:responder", "transfer:gerenciar"] },
  { codigo: "ATENDENTE", nome: "Atendente / vendedor", descricao: "Monta listas, lança e importa reservas.", permissoes: ["pessoas:ver", "saidas:gerenciar", "reservas:editar", "importacoes:executar", "manifesto:ver", "manifesto:contatos", "marketing:ver", "biblioteca:ver", "ia:usar", "whatsapp:ver", "whatsapp:responder"] },
  { codigo: "GUIA", nome: "Guia de turismo", descricao: "Vê a lista e registra o embarque.", permissoes: ["manifesto:ver", "manifesto:contatos", "embarque:registrar", "biblioteca:ver"] },
  { codigo: "MOTORISTA", nome: "Motorista", descricao: "Vê a lista (sem contatos).", permissoes: ["manifesto:ver", "frota:checklist", "rastreio:transmitir", "biblioteca:ver", "transfer:operar"] },
].map((p) => ({ ...p, id: `perfil-${p.codigo.toLowerCase()}`, sistema: true, criadoEm: new Date().toISOString() }));
const perfilDe = (codigo: string) => perfis.find((p) => p.codigo === codigo)!;
const permissoesDe = (codigo: string) => (codigo === "ADMIN" ? TODAS : perfilDe(codigo)?.permissoes ?? []);

interface UnidadeDemo { id: string; codigo: string; nome: string; cidade: string; uf: string; ativa: boolean; criadoEm: string }
const unidades: UnidadeDemo[] = [
  { id: "un-bc", codigo: "BC", nome: "Balneário Camboriú (BC by Bus)", cidade: "Balneário Camboriú", uf: "SC" },
  { id: "un-fln", codigo: "FLN", nome: "Florianópolis (Floripa by Bus)", cidade: "Florianópolis", uf: "SC" },
].map((u) => ({ ...u, ativa: true, criadoEm: new Date().toISOString() }));
export const SENHA_DEMO = "Bybus-teste-2026";

let seq = 1;
const id = (p: string) => `${p}-${(seq++).toString(36)}`;
const agoraIso = () => new Date().toISOString();
const dataMais = (dias: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + dias * 86400_000));

interface Usuario { id: string; nome: string; email: string; perfil: string; todasUnidades: boolean; unidadeIds: string[]; ativo: boolean; totpAtivo: boolean; trocarSenha: boolean; criadoEm: string; senha: string }
interface Pessoa { id: string; nome: string; papeis: string[]; unidadeId: string | null; telefone: string | null; email: string | null; documentoTipo: string | null; documento: string | null; cnhCategoria: string | null; cnhValidade: string | null; cadasturNumero: string | null; cadasturValidade: string | null; idiomas: string[]; diariaCentavos: number | null; observacoes: string | null; ativo: boolean; criadoEm: string }
interface Pax { id: string; reservaId: string; nome: string; categoria: Categoria; documentoTipo: TipoDocumento | null; documento: string | null; documentoPais: string | null; pontoEmbarqueId: string | null; embarque: "PENDENTE" | "EMBARCOU" | "NO_SHOW"; seq: number }
interface Reserva { id: string; saidaId: string; canal: Canal; canalOrigem: Canal; codigoExterno: string | null; referencias: string[]; contatoNome: string; contatoTelefone: string | null; contatoEmail: string | null; pontoEmbarqueId: string | null; status: "CONFIRMADA" | "CANCELADA"; observacoes: string | null; origem: string; criadoEm: string; atualizadoEm: string }
interface Saida { id: string; passeioId: string; data: string; status: "PREVISTA" | "CONFIRMADA" | "CANCELADA" | "REALIZADA"; capacidade: number; veiculo: string | null; guia: string | null; motorista: string | null; guiaId: string | null; motoristaId: string | null; observacoes: string | null; criadoEm: string }

const demoIntegracao: { paytourEm: string; emailsEm: string; paytour: Record<string, unknown> } = {
  paytourEm: new Date(Date.now() - 90_000).toISOString(),
  emailsEm: new Date(Date.now() - 240_000).toISOString(),
  paytour: { pedidos: 5, CRIAR: 3, ATUALIZAR: 1, CANCELAR: 1, IGNORAR: 0 },
};

const usuarios: Usuario[] = ([
  ["Admin Demo", "admin@bybus.test", "ADMIN", null], ["Supervisora Demo", "supervisor@bybus.test", "SUPERVISOR", "un-fln"],
  ["Atendente Demo", "atendente@bybus.test", "ATENDENTE", "un-fln"], ["Guia Demo", "guia@bybus.test", "GUIA", "un-fln"], ["Motorista Demo", "motorista@bybus.test", "MOTORISTA", "un-fln"],
  ["Supervisor BC Demo", "supervisor.bc@bybus.test", "SUPERVISOR", "un-bc"],
] as const).map(([nome, email, perfil, unidade]) => ({ id: id("u"), nome, email, perfil, todasUnidades: unidade === null, unidadeIds: unidade ? [unidade] : [], ativo: true, totpAtivo: false, trocarSenha: false, criadoEm: agoraIso(), senha: SENHA_DEMO }));

interface PasseioDemo { id: string; codigo: string; nome: string; cidade: string; unidadeId: string; linha: string; capacidadePadrao: number; minimoConfirmacao: number; minimoSupervisor: number; ativo: boolean }
const passeio: PasseioDemo = { id: "toda-ilha", codigo: "TODA_ILHA", nome: "City Tour Toda Ilha", cidade: "Florianópolis", unidadeId: "un-fln", linha: "CITY_TOUR", capacidadePadrao: 73, minimoConfirmacao: 12, minimoSupervisor: 10, ativo: true };
const passeios: PasseioDemo[] = [
  passeio,
  { id: "bc-tour", codigo: "BC_CITY_TOUR", nome: "City Tour Balneário Camboriú (fictício)", cidade: "Balneário Camboriú", unidadeId: "un-bc", linha: "CITY_TOUR", capacidadePadrao: 46, minimoConfirmacao: 10, minimoSupervisor: 8, ativo: true },
  { id: "bc-fret", codigo: "BC_FRETAMENTO", nome: "Fretamento para eventos (fictício)", cidade: "Balneário Camboriú", unidadeId: "un-bc", linha: "FRETAMENTO", capacidadePadrao: 46, minimoConfirmacao: 0, minimoSupervisor: 0, ativo: true },
];
const pontos = PONTOS_TODA_ILHA.map((p, i) => ({ ...p, id: `ponto-${i + 1}`, passeioId: passeio.id, ativo: true, latitude: null as number | null, longitude: null as number | null }));
const pontosDe = (passeioId: string) => pontos.filter((p) => p.passeioId === passeioId);
const pessoaBase = { telefone: null, email: null, documentoTipo: null, documento: null, cnhCategoria: null, cnhValidade: null, cadasturNumero: null, cadasturValidade: null, idiomas: [], diariaCentavos: null, observacoes: null, ativo: true, criadoEm: new Date().toISOString() };
const pessoas: Pessoa[] = [
  { ...pessoaBase, id: "pe-ana", nome: "Guia Fictícia Ana", papeis: ["GUIA"], unidadeId: "un-fln", idiomas: ["Português", "Espanhol", "Inglês"], diariaCentavos: 30000, cadasturNumero: "00.000000.00.0000-0", cadasturValidade: dataMais(20) },
  { ...pessoaBase, id: "pe-bia", nome: "Guia Fictícia Bia", papeis: ["GUIA"], unidadeId: "un-fln", idiomas: ["Português", "Espanhol"], diariaCentavos: 30000, cadasturValidade: dataMais(400) },
  { ...pessoaBase, id: "pe-caio", nome: "Guia Fictício Caio", papeis: ["GUIA"], unidadeId: null, idiomas: ["Português", "Inglês"], diariaCentavos: 32000 },
  { ...pessoaBase, id: "pe-davi", nome: "Motorista Fictício Davi", papeis: ["MOTORISTA"], unidadeId: "un-fln", cnhCategoria: "D", cnhValidade: dataMais(-3) },
  { ...pessoaBase, id: "pe-edu", nome: "Motorista Fictício Edu", papeis: ["MOTORISTA"], unidadeId: "un-bc", cnhCategoria: "D", cnhValidade: dataMais(500) },
  { ...pessoaBase, id: "pe-fred", nome: "Motorista Fictício Fred", papeis: ["MOTORISTA", "COLABORADOR"], unidadeId: "un-bc", cnhCategoria: "E", cnhValidade: dataMais(25) },
];
const saidas: Saida[] = [];
const conferenciaDemo = new Map<string, { em: string; por: string }>();
const fechamentoDemo = new Map<string, { em: string; versao: number }>();
const mensagensDemo: Array<{ id: string; tipo: string; status: string; provedor: string; erro: string | null; criadoEm: string; enviadaEm: string | null; titular: string; destino: string | null; texto: string; saidaId: string; reservaId: string }> = [];
/** Pagamento e origem fictícios e estáveis por reserva. */
function extrasDemo(r: { id: string; canal: string; canalOrigem: string | null }) {
  const n = [...r.id].reduce((t, ch) => t + ch.charCodeAt(0), 0);
  const canal = r.canalOrigem ?? r.canal;
  if (canal !== "PAYTOUR" && canal !== "BALCAO") return { pagamento: "PAGO" as const, formaPagamento: `Pago na ${canal === "VIATOR" ? "Viator" : canal === "DECOLAR" ? "Decolar" : "Civitatis"}`, origemCliente: ["ARG", "USA", "CHL", "URY"][n % 4]! };
  const opcoes = [{ pagamento: "PAGO" as const, formaPagamento: "Pix" }, { pagamento: "PAGO" as const, formaPagamento: "Cartão" }, { pagamento: "A_PAGAR" as const, formaPagamento: "Pagar no dia" }];
  return { ...opcoes[n % 3]!, origemCliente: ["SP", "RS", "PR", "SC", "MG", "RJ"][n % 6]! };
}
const escalaDemo = new Map<string, { guiaId: string | null; motoristaId: string | null; origem: "ESCALA" | "TROCA"; motivo: string | null; publicada: boolean }>();
const motoristaPadraoDemo: Record<string, string | null> = { "toda-ilha": "pe-davi" };
// Mês atual do City Tour: Ana e Bia se revezam; amanhã houve uma troca por força maior.
for (let i = -10; i <= 40; i++) {
  const data = dataMais(i);
  escalaDemo.set(`toda-ilha|${data}`, { guiaId: i % 2 === 0 ? "pe-ana" : "pe-bia", motoristaId: null, origem: i === 1 ? "TROCA" : "ESCALA", motivo: i === 1 ? "Guia com atestado médico (fictício)" : null, publicada: i <= 25 });
}
const reservas: Reserva[] = [];
const pax: Pax[] = [];
const auditoria: Array<{ id: string; acao: string; entidade: string | null; entidadeId: string | null; dados: Record<string, unknown> | null; ip: string | null; criadoEm: string; usuario: string | null }> = [];
let sessao: Usuario | null = null;

// ---------- Dados fictícios ----------
const NOMES = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio", "Gabriela", "Heitor", "Isis", "João", "Karen", "Lucas", "Marina", "Nicolas", "Olívia", "Paulo", "Renata", "Samuel", "Tânia", "Vitor"];
const SOBRENOMES = ["Exemplo", "Fictício", "Demonstração", "Teste", "Modelo", "Amostra"];
const ESTRANGEIROS = ["John Sample", "Mary Example", "Lucía Prueba", "Pierre Exemple", "Hans Beispiel"];
function cpfFicticio(s: number) {
  const base = String(100000000 + ((s * 7919) % 899999999)).slice(0, 9).split("").map(Number);
  const dv = (d: number[]) => { const t = d.reduce((a, n, i) => a + n * (d.length + 1 - i), 0); const r = (t * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(base); return [...base, d1, dv([...base, d1])].join("");
}
(function semear() {
  const canais: Canal[] = ["PAYTOUR", "PAYTOUR", "PAYTOUR", "VIATOR", "DECOLAR", "CIVITATIS", "BALCAO"];
  let s = 1;
  for (const [dia, qtd, status] of [[0, 15, "CONFIRMADA"], [1, 9, "PREVISTA"], [2, 4, "PREVISTA"], [3, 14, "PREVISTA"], [5, 7, "PREVISTA"]] as const) {
    const saida: Saida = { id: `saida-${dia}`, passeioId: passeio.id, data: dataMais(dia), status, capacidade: 73, veiculo: "QJQ2A16 (fictício)", guia: dia === 0 ? "Guia Fictícia Ana" : null, motorista: dia === 0 ? "Motorista Fictício Davi" : null, guiaId: dia === 0 ? "pe-ana" : null, motoristaId: dia === 0 ? "pe-davi" : null, observacoes: null, criadoEm: agoraIso() };
    saidas.push(saida);
    for (let i = 0; i < qtd; i++) {
      const canal = canais[(i + dia) % canais.length]!;
      const estrangeiro = canal === "VIATOR";
      const titular = estrangeiro ? ESTRANGEIROS[i % ESTRANGEIROS.length]! : `${NOMES[(i * 3 + dia) % NOMES.length]} ${SOBRENOMES[i % SOBRENOMES.length]}`;
      const semPonto = canal !== "PAYTOUR" && canal !== "BALCAO" && i % 2 === 0;
      const r: Reserva = {
        id: id("r"), saidaId: saida.id, canal, canalOrigem: canal, codigoExterno: `${canal}-DEMO-${dia}${String(i).padStart(3, "0")}`, referencias: [],
        contatoNome: titular, contatoTelefone: `+55 48 90000-${String(1000 + s).slice(-4)}`, contatoEmail: null,
        pontoEmbarqueId: semPonto ? null : pontos[(i * 5 + dia) % pontos.length]!.id, status: "CONFIRMADA", observacoes: null, origem: "FICTICIO", criadoEm: agoraIso(), atualizadoEm: agoraIso(),
      };
      reservas.push(r);
      const tamanho = 1 + ((i + dia) % 4);
      const cats: Categoria[] = ["ADULTO", "ADULTO", "INFANTIL", "SENIOR", "COLO"];
      for (let k = 0; k < tamanho; k++) {
        s++;
        const nome = k === 0 ? titular : estrangeiro && k > 1 ? "" : `${NOMES[(s * 7) % NOMES.length]} ${titular.split(" ").pop()}`;
        const tipo: TipoDocumento | null = estrangeiro ? (k === 0 ? "PASSAPORTE" : null) : "CPF";
        pax.push({ id: id("p"), reservaId: r.id, nome, categoria: cats[k % cats.length]!, documentoTipo: tipo, documento: tipo === "PASSAPORTE" ? `X${1000000 + s}` : tipo ? cpfFicticio(s) : null, documentoPais: estrangeiro && k === 0 ? "EUA (fictício)" : null, pontoEmbarqueId: null, embarque: dia === 0 && s % 3 === 0 ? "EMBARCOU" : "PENDENTE", seq: s });
      }
    }
  }
  // Praça BC: saídas sem reservas (só para mostrar o seletor de praça e as linhas de negócio).
  saidas.push(
    { id: "saida-bc-1", passeioId: "bc-tour", data: dataMais(1), status: "PREVISTA", capacidade: 46, veiculo: null, guia: null, motorista: "Motorista Fictício Edu", guiaId: null, motoristaId: "pe-edu", observacoes: null, criadoEm: agoraIso() },
    { id: "saida-bc-2", passeioId: "bc-fret", data: dataMais(2), status: "CONFIRMADA", capacidade: 46, veiculo: "Ônibus fictício 02", guia: null, motorista: null, guiaId: null, motoristaId: null, observacoes: "Evento corporativo fictício", criadoEm: agoraIso() },
  );
})();

// ---------- Utilidades ----------
class Erro extends Error { constructor(public status: number, public codigo: string, msg: string) { super(msg); } }
const pode = (perm: string) => !!sessao && permissoesDe(sessao.perfil).includes(perm);
const ehAdmin = () => sessao?.perfil === "ADMIN";
const podeUnidade = (unidadeId: string | null | undefined) => !!sessao && (sessao.todasUnidades || (!!unidadeId && sessao.unidadeIds.includes(unidadeId)));
const passeioDe = (passeioId: string) => passeios.find((p) => p.id === passeioId)!;
const unidadeDaSaida = (s: Saida) => passeioDe(s.passeioId).unidadeId;
function saidaDoUsuario(saidaId: string) {
  const s = achar(saidas, saidaId, "Saída");
  if (!podeUnidade(unidadeDaSaida(s))) throw new Erro(404, "NAO_ENCONTRADO", "Saída não encontrada.");
  return s;
}
const contido = (a: string[], b: string[]) => a.every((x) => b.includes(x));
function podeConceder(perfilCodigo: string | undefined, todas?: boolean, ids?: string[]) {
  if (ehAdmin()) return;
  if (perfilCodigo && (perfilCodigo === "ADMIN" || !contido(permissoesDe(perfilCodigo), permissoesDe(sessao!.perfil)))) throw new Erro(403, "SEM_PERMISSAO", "Você não pode conceder um perfil com mais acesso que o seu.");
  if (todas && !sessao!.todasUnidades) throw new Erro(403, "SEM_PERMISSAO", "Você não pode conceder acesso a todas as praças.");
  if (ids?.some((i) => !podeUnidade(i))) throw new Erro(403, "SEM_PERMISSAO", "Você só pode conceder acesso às suas praças.");
}
function mascarar(doc: string | null) {
  return doc ? `•••${doc.replace(/\W/g, "").slice(-3)}` : null;
}
function pessoaPublica(p: Pessoa) {
  const completa = pode("pessoas:gerenciar") && (p.unidadeId ? podeUnidade(p.unidadeId) : sessao!.todasUnidades);
  if (!completa) return { id: p.id, nome: p.nome, papeis: p.papeis, unidadeId: p.unidadeId, idiomas: p.idiomas, ativo: p.ativo };
  return { ...p, documento: mascarar(p.documento) };
}
function passeioPublico(p: PasseioDemo) {
  const u = unidades.find((x) => x.id === p.unidadeId);
  return { ...p, unidade: u?.nome ?? "", unidadeCodigo: u?.codigo ?? "" };
}
function exigir(perm?: string) {
  if (!sessao) throw new Erro(401, "NAO_AUTENTICADO", "Faça login para continuar.");
  if (perm && !pode(perm)) throw new Erro(403, "SEM_PERMISSAO", "Seu perfil não tem acesso a esta função.");
}
function auditar(acao: string, entidade?: string, entidadeId?: string, dados?: Record<string, unknown>) {
  auditoria.unshift({ id: id("a"), acao, entidade: entidade ?? null, entidadeId: entidadeId ?? null, dados: dados ?? null, ip: "demonstração", criadoEm: agoraIso(), usuario: sessao?.nome ?? null });
}
const docMascarado = (p: Pax) => (p.documento ? mascararDocumento(p.documento) : null);
const docValido = (p: Pax) => (p.documento && p.documentoTipo ? documentoValido(p.documentoTipo, p.documento) : null);
const achar = <T extends { id: string }>(lista: T[], i: string, nome: string) => { const x = lista.find((y) => y.id === i); if (!x) throw new Erro(404, "NAO_ENCONTRADO", `${nome} não encontrado(a).`); return x; };
function definirDoc(p: Pax, tipo: TipoDocumento | null | undefined, valor: string | null | undefined) {
  if (!tipo || !valor?.trim()) { p.documentoTipo = tipo ?? null; p.documento = null; return; }
  p.documentoTipo = tipo; p.documento = normalizarDocumento(tipo, valor);
}
function resumoSaida(s: Saida) {
  const ps0 = passeioDe(s.passeioId);
  const ativas = reservas.filter((r) => r.saidaId === s.id && r.status === "CONFIRMADA");
  const ps = pax.filter((p) => ativas.some((r) => r.id === p.reservaId));
  return {
    ...s, passeio: ps0.nome, linha: ps0.linha, unidadeId: ps0.unidadeId, reservas: ativas.length, passageiros: ps.length,
    assentos: ps.filter((p) => p.categoria !== "COLO").length, pagantes: ps.filter((p) => p.categoria !== "COLO" && p.categoria !== "CORTESIA").length,
  };
}
function manifesto(saidaId: string, completos: boolean) {
  const s = saidaDoUsuario(saidaId);
  const passeio = passeioDe(s.passeioId);
  const pontos = pontosDe(s.passeioId);
  const rs = reservas.filter((r) => r.saidaId === s.id);
  const verContatos = pode("manifesto:contatos");
  const m = montarManifesto(pontos, rs.map((r) => ({
    id: r.id, canal: r.canal, codigoExterno: r.codigoExterno, contatoNome: r.contatoNome, contatoTelefone: verContatos ? r.contatoTelefone : null,
    pontoEmbarqueId: r.pontoEmbarqueId, status: r.status, observacoes: r.observacoes,
    passageiros: pax.filter((p) => p.reservaId === r.id).sort((a, b) => a.seq - b.seq).map((p) => ({
      id: p.id, nome: p.nome, categoria: p.categoria, documentoTipo: p.documentoTipo, embarque: p.embarque, pontoEmbarqueId: p.pontoEmbarqueId, documentoValido: docValido(p),
      documento: completos && p.documento ? (p.documentoTipo === "CPF" ? formatarCpf(p.documento) : p.documento) : docMascarado(p),
    })),
  })), { capacidade: s.capacidade, minimoConfirmacao: passeio.minimoConfirmacao, minimoSupervisor: passeio.minimoSupervisor, documentoObrigatorio: false },
  detectarDuplicatas(rs.filter((r) => r.status === "CONFIRMADA").map((r) => ({ id: r.id, canal: r.canal, canalOrigem: r.canalOrigem, codigoExterno: r.codigoExterno, referencias: r.referencias, contatoNome: r.contatoNome, categorias: pax.filter((p) => p.reservaId === r.id).map((p) => p.categoria) }))));
  return { saida: s, passeio, manifesto: m };
}
const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function casarPonto(texto: string | null) {
  if (!texto) return null;
  const alvo = normalizar(texto);
  const ign = new Set(["hotel", "transfer", "e", "de", "da", "do", "fundos", "em", "frente", "ao", "praca", "praia"]);
  const exato = pontos.find((p) => normalizar(p.nome) === alvo);
  if (exato) return exato;
  const c = pontos.filter((p) => normalizar(p.nome).split(" ").filter((w) => w.length > 2 && !ign.has(w)).some((w) => alvo.includes(w)));
  return c.length === 1 ? c[0]! : null;
}
function importar(itens: ReservaImportada[], confirmar: boolean) {
  const previa = itens.map((item) => {
    const avisos = [...item.avisos];
    const base = { canal: item.canal, codigoExterno: item.codigoExterno, data: item.data, contatoNome: item.contatoNome, passageiros: item.passageiros.length };
    if (item.produto && !/toda ilha|whole island|floripa city tour/i.test(item.produto)) return { ...base, pontoEmbarque: null, acao: "IGNORAR" as const, avisos: [...avisos, `Produto "${item.produto}" não é City Tour Toda Ilha.`] };
    const ponto = casarPonto(item.pontoEmbarqueTexto);
    if (item.pontoEmbarqueTexto && !ponto) avisos.push(`Ponto de embarque "${item.pontoEmbarqueTexto}" não reconhecido — definir manualmente.`);
    if (!item.pontoEmbarqueTexto) avisos.push("Sem ponto de embarque — contatar o cliente no dia anterior.");
    const existente = reservas.find((r) => r.canal === item.canal && r.codigoExterno === item.codigoExterno);
    const acao = item.cancelada ? (existente && existente.status !== "CANCELADA" ? "CANCELAR" : "IGNORAR") : existente ? "ATUALIZAR" : "CRIAR";
    if (confirmar) {
      if (acao === "CANCELAR") existente!.status = "CANCELADA";
      if (acao === "ATUALIZAR") { existente!.status = "CONFIRMADA"; existente!.pontoEmbarqueId ??= ponto?.id ?? null; }
      if (acao === "CRIAR") {
        let s = saidas.find((x) => x.data === item.data && x.passeioId === passeio.id);
        if (!s) { s = { id: id("saida"), passeioId: passeio.id, data: item.data, status: "PREVISTA", capacidade: 73, veiculo: null, guia: null, motorista: null, guiaId: null, motoristaId: null, observacoes: null, criadoEm: agoraIso() }; saidas.push(s); }
        const r: Reserva = { id: id("r"), saidaId: s.id, canal: item.canal, canalOrigem: item.canal, codigoExterno: item.codigoExterno, referencias: item.referencias, contatoNome: item.contatoNome || "(sem nome)", contatoTelefone: item.contatoTelefone, contatoEmail: item.contatoEmail, pontoEmbarqueId: ponto?.id ?? null, status: "CONFIRMADA", observacoes: item.observacoes, origem: "IMPORTACAO", criadoEm: agoraIso(), atualizadoEm: agoraIso() };
        reservas.push(r);
        for (const p of item.passageiros) { const n: Pax = { id: id("p"), reservaId: r.id, nome: p.nome, categoria: p.categoria, documentoTipo: null, documento: null, documentoPais: null, pontoEmbarqueId: null, embarque: "PENDENTE", seq: seq++ }; definirDoc(n, p.documentoTipo, p.documento); pax.push(n); }
      }
    }
    return { ...base, pontoEmbarque: ponto?.nome ?? null, acao, avisos };
  });
  const resumo = { CRIAR: 0, ATUALIZAR: 0, CANCELAR: 0, IGNORAR: 0 } as Record<string, number>;
  previa.forEach((p) => resumo[p.acao]!++);
  if (confirmar) auditar("IMPORTACAO", "importacao", undefined, resumo);
  return { previa, resumo };
}
const publicoUsuario = (u: Usuario) => { const { senha: _s, ...r } = u; return { ...r, perfilNome: perfilDe(u.perfil)?.nome ?? u.perfil }; };
const alcance = (u: Usuario) => ehAdmin() || u.id === sessao!.id || (u.perfil !== "ADMIN" && contido(permissoesDe(u.perfil), permissoesDe(sessao!.perfil)) && (!u.todasUnidades || sessao!.todasUnidades) && u.unidadeIds.every(podeUnidade));

// ---------- Módulos novos (financeiro, frota, marketing, biblioteca, IA): ver os arquivos *Demo.ts ----------
const ctxModulos: Ctx = { exigir, erro: (status, codigo, msg) => new Erro(status, codigo, msg), id, auditar, dataMais, agoraIso };
/** Quem vem de transfer, para o texto da lista (mesmo formato da API). */
const textoTransfer = (saidaId: string) => { const t = transferDemo.viaTransfer(saidaId); return t ? { encontro: t.encontro, porReserva: new Map(Object.entries(t.reservas)) } : undefined; };
const whatsappDemo = criarWhatsappDemo({
  podeUnidade: (unidadeId) => podeUnidade(unidadeId),
  usuarioNome: () => sessao?.nome ?? "Atendente Demo",
  reservas: () => reservas,
  saida: (saidaId) => { const s = saidas.find((x) => x.id === saidaId); const p = s && passeios.find((x) => x.id === s.passeioId); return s && p ? { data: s.data, passeio: p.nome, unidadeId: p.unidadeId } : undefined; },
  passageiros: (reservaId) => pax.filter((x) => x.reservaId === reservaId).length,
});
const transferDemo = criarTransferDemo({
  passeio: { id: passeio.id, nome: passeio.nome, unidadeId: passeio.unidadeId },
  podeUnidade: (unidadeId) => podeUnidade(unidadeId),
  pode: (perm) => pode(perm),
  // O motorista da demonstração (login motorista@bybus.test) é o motorista fixo do transfer.
  pessoaDoUsuario: () => (sessao?.email === "motorista@bybus.test" ? "pe-davi" : null),
  usuarioNome: () => sessao?.nome ?? "Motorista Demo",
  saidaDe: (passeioId, data) => saidas.find((s) => s.passeioId === passeioId && s.data === data),
  reservas: () => reservas,
  paxDe: (reservaId) => pax.filter((p) => p.reservaId === reservaId),
  pontos: () => pontos.map((p) => ({ id: p.id, nome: p.nome, horario: p.horario, ehTransfer: p.ehTransfer })),
  criarReserva: (saidaId, n) => {
    const r: Reserva = { id: id("r"), saidaId, canal: "PAYTOUR", canalOrigem: "PAYTOUR", codigoExterno: `PAYTOUR-DEMO-T${seq}`, referencias: [], contatoNome: n.titular, contatoTelefone: n.telefone, contatoEmail: null, pontoEmbarqueId: n.pontoId || null, status: "CONFIRMADA", observacoes: null, origem: "FICTICIO", criadoEm: agoraIso(), atualizadoEm: agoraIso() };
    reservas.push(r);
    n.categorias.forEach((categoria, k) => pax.push({ id: id("p"), reservaId: r.id, nome: k === 0 ? n.titular : `${n.titular.split(" ")[0]} (acompanhante ${k})`, categoria: categoria as Categoria, documentoTipo: null, documento: null, documentoPais: null, pontoEmbarqueId: null, embarque: "PENDENTE", seq: seq++ }));
    return r.id;
  },
  motoristas: () => pessoas.filter((p) => p.papeis.includes("MOTORISTA") && p.ativo && podeUnidade(p.unidadeId)).map((p) => ({ id: p.id, nome: p.nome })),
});
transferDemo.iniciar(); // cria já as reservas fictícias do transfer de amanhã (antes de qualquer lista ser aberta)
whatsappDemo.preparar(); // troca já os telefones das reservas ligadas às conversas (antes de qualquer mensagem da fila)

// ---------- Rotas ----------
type Corpo = Record<string, any>;
function rotear(metodo: string, caminho: string, q: URLSearchParams, c: Corpo): unknown {
  let m: RegExpMatchArray | null;
  const r = (re: RegExp) => (m = caminho.match(re));

  if (metodo === "POST" && caminho === "/api/auth/login") {
    const u = usuarios.find((x) => x.email.toLowerCase() === String(c.email ?? "").toLowerCase());
    if (!u || !u.ativo || u.senha !== c.senha) throw new Erro(401, "CREDENCIAIS_INVALIDAS", "E-mail ou senha incorretos. Na demonstração, use a senha Bybus-teste-2026.");
    sessao = u; auditar("LOGIN", "usuario", u.id);
    return { usuario: publicoUsuario(u) };
  }
  if (metodo === "GET" && caminho === "/api/auth/eu") {
    exigir();
    return {
      usuario: publicoUsuario(sessao!), pendencia: sessao!.trocarSenha ? "TROCAR_SENHA" : null, permissoes: permissoesDe(sessao!.perfil),
      unidades: unidades.filter((u) => u.ativa && podeUnidade(u.id)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map(({ id: i, codigo, nome }) => ({ id: i, codigo, nome })),
    };
  }
  if (metodo === "POST" && caminho === "/api/auth/logout") { sessao = null; return { ok: true }; }
  if (metodo === "POST" && caminho === "/api/auth/senha") {
    exigir();
    if (c.senhaAtual !== sessao!.senha) throw new Erro(400, "SENHA_ATUAL_INCORRETA", "Senha atual incorreta.");
    if (String(c.novaSenha).length < 10 || !/[A-Za-z]/.test(c.novaSenha) || !/\d/.test(c.novaSenha)) throw new Erro(400, "SENHA_FRACA", "A senha deve ter pelo menos 10 caracteres, com letras e números.");
    sessao!.senha = c.novaSenha; sessao!.trocarSenha = false; return { ok: true };
  }
  if (metodo === "POST" && caminho === "/api/auth/mfa/iniciar") { exigir(); return { segredo: "DEMOJBSWY3DPEHPK3PXP", otpauth: "otpauth://totp/Bybus%20Gest%C3%A3o:demo?secret=DEMOJBSWY3DPEHPK3PXP&issuer=Bybus%20Gest%C3%A3o" }; }
  if (metodo === "POST" && caminho === "/api/auth/mfa/ativar") { exigir(); if (!/^\d{6}$/.test(String(c.codigo ?? "").replace(/\s/g, ""))) throw new Erro(400, "MFA_INVALIDO", "Código inválido."); sessao!.totpAtivo = true; return { ok: true }; }
  if (metodo === "GET" && caminho === "/api/auth/sessoes") { exigir(); return [{ id: "0123456789abcdef", criadaEm: agoraIso(), ultimoUso: agoraIso(), ip: "demonstração", userAgent: navigator.userAgent, atual: true }]; }
  if (metodo === "DELETE" && r(/^\/api\/auth\/sessoes\/[^/]+$/)) { exigir(); return { ok: true }; }

  if (metodo === "GET" && caminho === "/api/passeios") { exigir("manifesto:ver"); return passeios.filter((p) => p.ativo && podeUnidade(p.unidadeId)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map(passeioPublico); }
  if (metodo === "POST" && caminho === "/api/passeios") {
    exigir("produtos:gerenciar");
    if (!podeUnidade(c.unidadeId)) throw new Erro(403, "SEM_PERMISSAO", "Você só pode cadastrar passeios das suas praças.");
    const codigo = String(c.codigo ?? "").toUpperCase();
    if (!/^[A-Z0-9_]{2,40}$/.test(codigo) || String(c.nome ?? "").trim().length < 2) throw new Erro(400, "DADOS_INVALIDOS", "Dados inválidos. Revise os campos.");
    if (passeios.some((p) => p.codigo === codigo)) throw new Erro(409, "PASSEIO_EXISTE", "Já existe passeio com este código.");
    const novo: PasseioDemo = { id: id("passeio"), codigo, nome: c.nome, cidade: c.cidade, unidadeId: c.unidadeId, linha: c.linha, capacidadePadrao: c.capacidadePadrao, minimoConfirmacao: c.minimoConfirmacao ?? 0, minimoSupervisor: c.minimoSupervisor ?? 0, ativo: c.ativo ?? true };
    passeios.push(novo); auditar("PASSEIO_CRIADO", "passeio", novo.id, { codigo, linha: novo.linha }); return novo;
  }
  if (metodo === "PATCH" && r(/^\/api\/passeios\/([^/]+)$/)) {
    exigir("produtos:gerenciar");
    const x = achar(passeios, m![1]!, "Passeio");
    if (!podeUnidade(x.unidadeId)) throw new Erro(404, "NAO_ENCONTRADO", "Passeio não encontrado.");
    for (const k of ["nome", "cidade", "linha", "capacidadePadrao", "minimoConfirmacao", "minimoSupervisor", "ativo"]) if (k in c) (x as any)[k] = c[k];
    auditar("PASSEIO_ALTERADO", "passeio", x.id); return x;
  }
  if (metodo === "GET" && r(/^\/api\/passeios\/([^/]+)\/pontos$/)) { exigir("manifesto:ver"); return pontosDe(m![1]!); }
  if (metodo === "PATCH" && r(/^\/api\/pontos\/([^/]+)$/)) {
    exigir("pontos:gerenciar");
    const p = achar(pontos, m![1]!, "Ponto");
    const { latitude: la, longitude: lo } = c;
    if ((la == null) !== (lo == null)) throw new Erro(400, "DADOS_INVALIDOS", "Informe latitude e longitude juntas (ou deixe as duas em branco).");
    if (la != null && (typeof la !== "number" || Math.abs(la) > 90)) throw new Erro(400, "DADOS_INVALIDOS", "Latitude entre -90 e 90.");
    if (lo != null && (typeof lo !== "number" || Math.abs(lo) > 180)) throw new Erro(400, "DADOS_INVALIDOS", "Longitude entre -180 e 180.");
    const antes = { latitude: p.latitude, longitude: p.longitude };
    p.latitude = la ?? null; p.longitude = lo ?? null;
    auditar("PONTO_ALTERADO", "ponto", p.id, { latitude: p.latitude, longitude: p.longitude, antes });
    return p;
  }

  if (metodo === "GET" && caminho === "/api/saidas") {
    exigir("manifesto:ver");
    const de = q.get("de") ?? "0000", ate = q.get("ate") ?? "9999", uni = q.get("unidadeId"), pid = q.get("passeioId");
    return saidas
      .filter((s) => s.data >= de && s.data <= ate && podeUnidade(unidadeDaSaida(s)) && (!uni || unidadeDaSaida(s) === uni) && (!pid || s.passeioId === pid))
      .sort((a, b) => a.data.localeCompare(b.data)).map(resumoSaida);
  }
  if (metodo === "POST" && caminho === "/api/saidas") {
    exigir("saidas:gerenciar");
    const ps = achar(passeios, String(c.passeioId), "Passeio");
    if (!podeUnidade(ps.unidadeId)) throw new Erro(404, "NAO_ENCONTRADO", "Passeio não encontrado.");
    if (saidas.some((s) => s.data === c.data && s.passeioId === ps.id)) throw new Erro(409, "SAIDA_EXISTE", "Já existe saída deste passeio nesta data.");
    const s: Saida = { id: id("saida"), passeioId: ps.id, data: c.data, status: "PREVISTA", capacidade: c.capacidade ?? ps.capacidadePadrao, veiculo: c.veiculo ?? null, guia: null, motorista: null, guiaId: null, motoristaId: null, observacoes: null, criadoEm: agoraIso() };
    saidas.push(s); auditar("SAIDA_CRIADA", "saida", s.id); return s;
  }
  if (r(/^\/api\/saidas\/([^/]+)$/)) {
    exigir();
    const s = saidaDoUsuario(m![1]!);
    if (metodo === "GET") { exigir("manifesto:ver"); return { saida: s, passeio: passeioDe(s.passeioId) }; }
    if (metodo === "PATCH") {
      exigir("saidas:gerenciar");
      if (c.status !== undefined && !pode("saidas:decidir")) throw new Erro(403, "SEM_PERMISSAO", "Mudar o status da saída é decisão do supervisor.");
      const unidadeId = unidadeDaSaida(s);
      const escalar = (pid: string | null, papel: string) => {
        if (!pid) return null;
        const p = pessoas.find((x) => x.id === pid);
        if (!p || !p.ativo || !p.papeis.includes(papel) || (p.unidadeId && p.unidadeId !== unidadeId)) throw new Erro(400, "PESSOA_INVALIDA", papel === "GUIA" ? "Guia inválido(a) para esta praça." : "Motorista inválido(a) para esta praça.");
        return p;
      };
      if ("guiaId" in c) { const p = escalar(c.guiaId, "GUIA"); s.guiaId = p?.id ?? null; s.guia = p?.nome ?? null; }
      if ("motoristaId" in c) { const p = escalar(c.motoristaId, "MOTORISTA"); s.motoristaId = p?.id ?? null; s.motorista = p?.nome ?? null; }
      Object.assign(s, Object.fromEntries(Object.entries(c).filter(([k]) => ["status", "capacidade", "veiculo", "observacoes"].includes(k))));
      auditar("SAIDA_ALTERADA", "saida", s.id, { campos: Object.keys(c) }); return s;
    }
  }
  if (metodo === "GET" && r(/^\/api\/saidas\/([^/]+)\/manifesto$/)) {
    exigir("manifesto:ver");
    const completos = q.get("documentos") === "completos";
    if (completos && !pode("manifesto:documentos")) throw new Erro(403, "SEM_PERMISSAO", "Seu perfil não pode ver documentos completos.");
    auditar(completos ? "MANIFESTO_DOCUMENTOS_COMPLETOS" : "MANIFESTO_VISUALIZADO", "saida", m![1]);
    const resultado = manifesto(m![1]!, completos);
    return { ...resultado, transfer: transferDemo.viaTransfer(m![1]!) };
  }
  if (r(/^\/api\/saidas\/([^/]+)\/reservas$/)) {
    exigir();
    const s = saidaDoUsuario(m![1]!);
    if (metodo === "GET") {
      exigir("manifesto:ver");
      const ver = pode("manifesto:contatos");
      return reservas.filter((x) => x.saidaId === s.id).sort((a, b) => a.contatoNome.localeCompare(b.contatoNome, "pt-BR")).map((x) => ({
        ...x, contatoTelefone: ver ? x.contatoTelefone : null, contatoEmail: ver ? x.contatoEmail : null,
        passageiros: pax.filter((p) => p.reservaId === x.id).sort((a, b) => a.seq - b.seq).map((p) => ({ ...p, documento: docMascarado(p), documentoValido: docValido(p) })),
      }));
    }
    if (metodo === "POST") {
      exigir("reservas:editar");
      if (!c.contatoNome || String(c.contatoNome).trim().length < 2) throw new Erro(400, "DADOS_INVALIDOS", "Informe o nome do titular.");
      if (!Array.isArray(c.passageiros) || c.passageiros.length === 0) throw new Erro(400, "DADOS_INVALIDOS", "Inclua ao menos um passageiro.");
      const nova: Reserva = { id: id("r"), saidaId: s.id, canal: c.canal, canalOrigem: c.canal, codigoExterno: c.codigoExterno || null, referencias: [], contatoNome: c.contatoNome, contatoTelefone: c.contatoTelefone || null, contatoEmail: c.contatoEmail || null, pontoEmbarqueId: c.pontoEmbarqueId ?? null, status: "CONFIRMADA", observacoes: c.observacoes ?? null, origem: "MANUAL", criadoEm: agoraIso(), atualizadoEm: agoraIso() };
      reservas.push(nova);
      for (const p of c.passageiros as Corpo[]) { const n: Pax = { id: id("p"), reservaId: nova.id, nome: p.nome ?? "", categoria: p.categoria, documentoTipo: null, documento: null, documentoPais: p.documentoPais ?? null, pontoEmbarqueId: p.pontoEmbarqueId ?? null, embarque: "PENDENTE", seq: seq++ }; definirDoc(n, p.documentoTipo, p.documento); pax.push(n); }
      auditar("RESERVA_CRIADA", "reserva", nova.id, { canal: nova.canal, passageiros: c.passageiros.length }); return nova;
    }
  }
  if (metodo === "PATCH" && r(/^\/api\/reservas\/([^/]+)$/)) {
    exigir("reservas:editar");
    const x = achar(reservas, m![1]!, "Reserva");
    for (const k of ["contatoNome", "contatoTelefone", "contatoEmail", "pontoEmbarqueId", "observacoes", "status", "saidaId"]) if (k in c) (x as any)[k] = c[k] === "" ? null : c[k];
    x.atualizadoEm = agoraIso(); auditar(c.status === "CANCELADA" ? "RESERVA_CANCELADA" : "RESERVA_ALTERADA", "reserva", x.id); return x;
  }
  if (metodo === "POST" && r(/^\/api\/reservas\/([^/]+)\/passageiros$/)) {
    exigir("reservas:editar"); achar(reservas, m![1]!, "Reserva");
    const n: Pax = { id: id("p"), reservaId: m![1]!, nome: c.nome ?? "", categoria: c.categoria, documentoTipo: null, documento: null, documentoPais: c.documentoPais ?? null, pontoEmbarqueId: c.pontoEmbarqueId ?? null, embarque: "PENDENTE", seq: seq++ };
    definirDoc(n, c.documentoTipo, c.documento); pax.push(n); return { id: n.id };
  }
  if (r(/^\/api\/passageiros\/([^/]+)$/)) {
    exigir("reservas:editar");
    const p = achar(pax, m![1]!, "Passageiro");
    if (metodo === "DELETE") { pax.splice(pax.indexOf(p), 1); return { ok: true }; }
    if (metodo === "PATCH") {
      if (c.documentoTipo !== undefined && c.documento === undefined) throw new Erro(400, "DOCUMENTO_INCOMPLETO", "Ao mudar o tipo de documento, informe também o número.");
      for (const k of ["nome", "categoria", "documentoPais", "pontoEmbarqueId"]) if (k in c) (p as any)[k] = c[k];
      if (c.documento !== undefined) definirDoc(p, c.documentoTipo ?? p.documentoTipo, c.documento);
      return { id: p.id };
    }
  }
  if (metodo === "POST" && r(/^\/api\/passageiros\/([^/]+)\/embarque$/)) {
    exigir("embarque:registrar");
    const p = achar(pax, m![1]!, "Passageiro"); p.embarque = c.status; auditar("EMBARQUE_REGISTRADO", "passageiro", p.id, { status: c.status });
    return { id: p.id, embarque: p.embarque };
  }
  // Escala (demonstração): mês atual planejado e publicado, com uma troca de exemplo.
  if (metodo === "GET" && caminho === "/api/escala/equipe") {
    exigir("pessoas:ver");
    const ps = achar(passeios, String(q.get("passeioId")), "Passeio");
    const daPraca = pessoas.filter((p) => p.ativo && (!p.unidadeId || p.unidadeId === ps.unidadeId)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return { guias: daPraca.filter((p) => p.papeis.includes("GUIA")).map((p) => ({ id: p.id, nome: p.nome, cadasturValidade: p.cadasturValidade })), motoristas: daPraca.filter((p) => p.papeis.includes("MOTORISTA")).map((p) => ({ id: p.id, nome: p.nome })) };
  }
  if (metodo === "GET" && caminho === "/api/escala") {
    exigir("pessoas:ver");
    const ps = achar(passeios, String(q.get("passeioId")), "Passeio");
    const mes = String(q.get("mes"));
    const nome = (pid: string | null | undefined) => pessoas.find((p) => p.id === pid)?.nome ?? null;
    const [a, mm] = mes.split("-").map(Number) as [number, number];
    const total = new Date(Date.UTC(a, mm, 0)).getUTCDate();
    const padrao = motoristaPadraoDemo[ps.id] ?? null;
    return {
      passeio: { id: ps.id, nome: ps.nome, unidadeId: ps.unidadeId, motoristaPadraoId: padrao, motoristaPadrao: nome(padrao), veiculoPadrao: ps.id === passeio.id ? "QJQ2A16 (fictício)" : null },
      dias: Array.from({ length: total }, (_, i) => {
        const data = `${mes}-${String(i + 1).padStart(2, "0")}`;
        const e = escalaDemo.get(`${ps.id}|${data}`);
        const guia = pessoas.find((p) => p.id === e?.guiaId);
        const alertas = guia?.cadasturValidade && guia.cadasturValidade < data ? ["Cadastur do guia vencido nesta data."] : [];
        const sd = saidas.find((x) => x.passeioId === ps.id && x.data === data);
        return { data, guiaId: e?.guiaId ?? null, guia: guia?.nome ?? null, motoristaId: e?.motoristaId ?? null, motorista: nome(e?.motoristaId), origem: e ? e.origem : null, motivo: e?.motivo ?? null, publicada: e?.publicada ?? false, saida: sd ? { id: sd.id, data: sd.data, status: sd.status } : null, alertas };
      }),
    };
  }
  if (metodo === "PUT" && caminho === "/api/escala") {
    exigir("escala:gerenciar");
    const ps = achar(passeios, String(c.passeioId), "Passeio");
    const dias = (c.dias as Array<{ data: string; guiaId: string | null; motoristaId: string | null }>) ?? [];
    const bloqueados = dias.filter((d) => { const e = escalaDemo.get(`${ps.id}|${d.data}`); return e?.publicada && (e.guiaId !== d.guiaId || e.motoristaId !== d.motoristaId); });
    if (bloqueados.length) throw new Erro(409, "TROCA_EXIGE_MOTIVO", "Escala já publicada nesses dias: use “Trocar” e informe o motivo.");
    if (c.motoristaPadraoId !== undefined) motoristaPadraoDemo[ps.id] = (c.motoristaPadraoId as string | null) ?? null;
    for (const d of dias) {
      const e = escalaDemo.get(`${ps.id}|${d.data}`);
      escalaDemo.set(`${ps.id}|${d.data}`, { guiaId: d.guiaId, motoristaId: d.motoristaId, origem: e?.origem ?? "ESCALA", motivo: e?.motivo ?? null, publicada: (e?.publicada ?? false) || !!c.publicar });
    }
    if (c.publicar) for (const [k, e] of escalaDemo) if (k.startsWith(`${ps.id}|${c.mes}`)) e.publicada = true;
    auditar(c.publicar ? "ESCALA_PUBLICADA" : "ESCALA_SALVA", "passeio", ps.id);
    return { ok: true };
  }
  if (metodo === "POST" && caminho === "/api/escala/troca") {
    exigir("escala:gerenciar");
    if (String(c.motivo ?? "").trim().length < 5) throw new Erro(400, "DADOS_INVALIDOS", "Descreva o motivo da troca.");
    const ps = achar(passeios, String(c.passeioId), "Passeio");
    const k = `${ps.id}|${c.data}`;
    const e = escalaDemo.get(k);
    escalaDemo.set(k, { guiaId: c.guiaId !== undefined ? (c.guiaId as string | null) : e?.guiaId ?? null, motoristaId: c.motoristaId !== undefined ? (c.motoristaId as string | null) : e?.motoristaId ?? null, origem: "TROCA", motivo: String(c.motivo).trim(), publicada: true });
    const sd = saidas.find((x) => x.passeioId === ps.id && x.data === c.data);
    const novo = escalaDemo.get(k)!;
    if (sd) { sd.guiaId = novo.guiaId; sd.guia = pessoas.find((p) => p.id === novo.guiaId)?.nome ?? null; }
    auditar("ESCALA_TROCA", "passeio", ps.id);
    return { ok: true };
  }
  // Conferência, fechamento e mensagens (demonstração; WhatsApp sempre simulado).
  if (metodo === "GET" && caminho === "/api/conferencia") {
    exigir("reservas:editar");
    const de = q.get("de") ?? dataMais(0), ate = q.get("ate") ?? dataMais(7), sit = q.get("situacao") ?? "PENDENTE", uni = q.get("unidadeId");
    return reservas.filter((r) => r.status === "CONFIRMADA").map((r) => ({ r, s: saidas.find((x) => x.id === r.saidaId)! }))
      .filter(({ s }) => s && s.data >= de && s.data <= ate && podeUnidade(unidadeDaSaida(s)) && (!uni || unidadeDaSaida(s) === uni))
      .map(({ r, s }) => {
        const extra = extrasDemo(r);
        const conf = conferenciaDemo.get(r.id);
        const ponto = pontos.find((p) => p.id === r.pontoEmbarqueId) ?? null;
        const meus = pax.filter((p) => p.reservaId === r.id);
        const alertas = [!ponto ? "Sem ponto de embarque" : null, !r.contatoTelefone ? "Sem telefone" : null, extra.pagamento === "A_PAGAR" ? "Pagar no embarque" : null].filter((x): x is string => !!x);
        return { id: r.id, saidaId: s.id, data: s.data, passeio: passeioDe(s.passeioId).nome, passeioId: s.passeioId, canal: r.canalOrigem ?? r.canal, codigoExterno: r.codigoExterno,
          contatoNome: r.contatoNome, contatoTelefone: pode("manifesto:contatos") ? r.contatoTelefone : null, passageiros: meus.length,
          categorias: meus.reduce<Record<string, number>>((m2, x) => ({ ...m2, [x.categoria]: (m2[x.categoria] ?? 0) + 1 }), {}),
          ...extra, ponto: ponto ? { id: ponto.id, nome: ponto.nome, horario: ponto.horario, ehTransfer: ponto.ehTransfer } : null,
          hospedagemInformada: null, pediuTransfer: !!ponto?.ehTransfer, informadoPeloClienteEm: null,
          conferencia: conf ? "CONFERIDA" : "PENDENTE", conferidaEm: conf?.em ?? null, conferidaPor: conf?.por ?? null, linkGerado: false, alertas };
      })
      .filter((x) => sit === "TODAS" || x.conferencia === sit)
      .sort((a, b) => a.data.localeCompare(b.data) || (a.ponto?.horario ?? "99").localeCompare(b.ponto?.horario ?? "99"));
  }
  if (metodo === "POST" && r(/^\/api\/reservas\/([^/]+)\/conferir$/)) {
    exigir("reservas:editar");
    const res = achar(reservas, m![1]!, "Reserva");
    const pid = (c.pontoEmbarqueId as string | null | undefined) ?? res.pontoEmbarqueId;
    if (!pid) throw new Erro(400, "PONTO_OBRIGATORIO", "Defina o ponto de embarque antes de conferir.");
    res.pontoEmbarqueId = pid;
    conferenciaDemo.set(res.id, { em: agoraIso(), por: sessao!.nome });
    auditar("RESERVA_CONFERIDA", "reserva", res.id);
    return { ok: true };
  }
  if (metodo === "POST" && r(/^\/api\/reservas\/([^/]+)\/link-embarque$/)) {
    exigir("reservas:editar");
    achar(reservas, m![1]!, "Reserva");
    return { caminho: "/embarque/demonstracao-link-ficticio-0000", expiraEm: agoraIso() };
  }
  if (metodo === "GET" && caminho === "/api/fechamento") {
    exigir("saidas:decidir");
    const data = q.get("data") ?? dataMais(1);
    return {
      data, horaFechamento: "21:00", automatico: true, whatsapp: { provedor: "simulado", envioReal: false, grupoConfigurado: false },
      saidas: saidas.filter((s) => s.data === data && s.status !== "CANCELADA" && podeUnidade(unidadeDaSaida(s))).map((s) => {
        const rs = reservas.filter((r) => r.saidaId === s.id && r.status === "CONFIRMADA");
        const f = fechamentoDemo.get(s.id);
        const ms = mensagensDemo.filter((x) => x.saidaId === s.id);
        return { saidaId: s.id, passeio: passeioDe(s.passeioId).nome, data: s.data, guia: s.guia, motorista: s.motorista, veiculo: s.veiculo,
          listaFechadaEm: f?.em ?? null, versao: f?.versao ?? 0, reservas: rs.length, naoConferidas: rs.filter((r) => !conferenciaDemo.has(r.id)).length,
          semPonto: rs.filter((r) => !r.pontoEmbarqueId).length, depoisDoFechamento: 0,
          mensagens: ms.reduce<Record<string, number>>((acc, x) => ({ ...acc, [x.status]: (acc[x.status] ?? 0) + 1 }), {}) };
      }),
    };
  }
  if (r(/^\/api\/saidas\/([^/]+)\/(fechar|texto-lista)$/)) {
    const { saida: s, passeio: ps, manifesto: man } = manifesto(m![1]!, false);
    const extras = new Map(reservas.filter((x) => x.saidaId === s.id).map((x) => [x.id, extrasDemo(x)]));
    if (metodo === "GET") { exigir("manifesto:ver"); return { texto: textoListaGrupo(man, { passeio: ps.nome, data: s.data, guia: s.guia, motorista: s.motorista, veiculo: s.veiculo, versao: Math.max(1, fechamentoDemo.get(s.id)?.versao ?? 1) }, extras, textoTransfer(s.id)) }; }
    exigir("saidas:decidir");
    const versao = (fechamentoDemo.get(s.id)?.versao ?? 0) + 1;
    fechamentoDemo.set(s.id, { em: agoraIso(), versao });
    for (const res of reservas.filter((x) => x.saidaId === s.id && x.status === "CONFIRMADA")) {
      if (mensagensDemo.some((x) => x.reservaId === res.id && x.tipo === "CONFIRMACAO")) continue;
      const ponto = pontos.find((p) => p.id === res.pontoEmbarqueId) ?? null;
      const textoMsg = textoConfirmacao({ primeiroNome: res.contatoNome.split(" ")[0] ?? "", passeio: ps.nome, data: s.data, ponto: ponto ? { ...ponto, endereco: ponto.endereco ?? null } : null, linkEmbarque: null });
      mensagensDemo.push({ id: id("msg"), tipo: "CONFIRMACAO", status: res.contatoTelefone ? "SIMULADA" : "SEM_TELEFONE", provedor: "simulado", erro: null, criadoEm: agoraIso(), enviadaEm: null,
        titular: res.contatoNome, destino: res.contatoTelefone, saidaId: s.id, reservaId: res.id, texto: textoMsg });
      if (res.contatoTelefone) whatsappDemo.registrarFila({ telefone: res.contatoTelefone, texto: textoMsg, tipo: "CONFIRMACAO" }); // também aparece na conversa
    }
    auditar("LISTA_FECHADA", "saida", s.id);
    return { versao, texto: textoListaGrupo(man, { passeio: ps.nome, data: s.data, guia: s.guia, motorista: s.motorista, veiculo: s.veiculo, versao }, extras, textoTransfer(s.id)), resumo: {} };
  }
  if (metodo === "GET" && caminho === "/api/mensagens") {
    exigir("saidas:decidir");
    const ver = pode("manifesto:contatos");
    return mensagensDemo.filter((x) => x.saidaId === q.get("saidaId")).map(({ saidaId: _s, reservaId: _r, ...x }) => ({ ...x, destino: ver ? x.destino : x.destino ? `…${x.destino.slice(-4)}` : null, texto: ver ? x.texto : null }));
  }
  if (metodo === "POST" && r(/^\/api\/mensagens\/([^/]+)\/reenviar$/)) { exigir("saidas:decidir"); return { ok: true }; }

  // Integrações (demonstração): situação fictícia; "sincronizar" só simula a leitura.
  if (metodo === "GET" && caminho === "/api/integracoes/paytour") {
    exigir("importacoes:executar");
    return { configurada: true, automaticaACadaMinutos: 2, ultimaExecucaoEm: demoIntegracao.paytourEm, ultimoResultado: demoIntegracao.paytour, ultimoErro: null };
  }
  if (metodo === "POST" && caminho === "/api/integracoes/paytour/sincronizar") {
    exigir("importacoes:executar");
    demoIntegracao.paytourEm = agoraIso();
    demoIntegracao.paytour = { de: "", ate: "", pedidos: 2, resumo: { CRIAR: 0, ATUALIZAR: 2, CANCELAR: 0, IGNORAR: 0 } };
    return { de: "", ate: "", pedidos: 2, previa: [], resumo: { CRIAR: 0, ATUALIZAR: 2, CANCELAR: 0, IGNORAR: 0 } };
  }
  if (metodo === "GET" && caminho === "/api/integracoes/emails") {
    exigir("importacoes:executar");
    return { configurada: true, ultimaExecucaoEm: demoIntegracao.emailsEm, ultimoResultado: { mensagens: 3, CRIAR: 2, ATUALIZAR: 1, CANCELAR: 0, IGNORAR: 0, semLeitor: 0, precisamAtencao: 1, naoReconhecidas: 0 } };
  }
  if (metodo === "POST" && caminho === "/api/importacoes/bokun-email") {
    exigir("importacoes:executar");
    const lidos = (c.emails as Corpo[]).map((e) => lerEmailBokun(e.assunto ?? "", e.corpo ?? ""));
    const validos = lidos.filter((x): x is ReservaImportada => x !== null);
    if (!validos.length) throw new Erro(400, "NADA_RECONHECIDO", "Nenhum e-mail de reserva da Bókun foi reconhecido.");
    return { ...importar(validos, !!c.confirmar), naoReconhecidos: lidos.length - validos.length };
  }
  if (metodo === "POST" && caminho === "/api/importacoes/paytour-csv") {
    exigir("importacoes:executar");
    const lido = lerCsvPaytour(String(c.conteudo ?? ""));
    if (!lido.reservas.length) throw new Erro(400, "CSV_INVALIDO", lido.erros.map((e) => `Linha ${e.linha}: ${e.mensagem}`).join(" ") || "Nenhuma reserva encontrada.");
    return { ...importar(lido.reservas, !!c.confirmar), errosLeitura: lido.erros, colunasNaoEncontradas: lido.colunasNaoEncontradas };
  }
  if (caminho === "/api/usuarios" && metodo === "GET") { exigir("usuarios:gerenciar"); return usuarios.filter(alcance).map(publicoUsuario); }
  if (caminho === "/api/usuarios" && metodo === "POST") {
    exigir("usuarios:gerenciar");
    if (usuarios.some((u) => u.email === String(c.email).toLowerCase())) throw new Erro(409, "EMAIL_EM_USO", "Já existe um usuário com este e-mail.");
    if (!perfilDe(String(c.perfil ?? ""))) throw new Erro(400, "PERFIL_INVALIDO", `Perfil "${c.perfil}" não existe.`);
    podeConceder(c.perfil, !!c.todasUnidades, c.unidadeIds ?? []);
    const temporaria = "Demo" + Math.random().toString(36).slice(2, 10) + "7a";
    const u: Usuario = { id: id("u"), nome: c.nome, email: String(c.email).toLowerCase(), perfil: c.perfil, todasUnidades: !!c.todasUnidades, unidadeIds: c.unidadeIds ?? [], ativo: true, totpAtivo: false, trocarSenha: true, criadoEm: agoraIso(), senha: temporaria };
    usuarios.push(u); auditar("USUARIO_CRIADO", "usuario", u.id, { perfil: u.perfil });
    return { usuario: publicoUsuario(u), senhaTemporaria: temporaria };
  }
  if (metodo === "PATCH" && r(/^\/api\/usuarios\/([^/]+)$/)) {
    exigir("usuarios:gerenciar");
    const u = achar(usuarios, m![1]!, "Usuário");
    if (!alcance(u)) throw new Erro(404, "NAO_ENCONTRADO", "Usuário não encontrado.");
    if (u.id === sessao!.id && (c.ativo !== undefined || c.perfil || c.todasUnidades !== undefined || c.unidadeIds || c.redefinirMfa)) throw new Erro(400, "AUTO_ALTERACAO", "Você não pode alterar o próprio perfil, praças, status ou MFA — peça a outro administrador.");
    if (c.perfil && !perfilDe(c.perfil)) throw new Erro(400, "PERFIL_INVALIDO", `Perfil "${c.perfil}" não existe.`);
    podeConceder(c.perfil, c.todasUnidades, c.unidadeIds);
    const outrosAdmins = usuarios.filter((x) => x.id !== u.id && x.perfil === "ADMIN" && x.ativo).length;
    if (u.perfil === "ADMIN" && (c.ativo === false || (c.perfil && c.perfil !== "ADMIN")) && outrosAdmins === 0) throw new Erro(400, "ULTIMO_ADMIN", "Este é o último administrador ativo.");
    let temporaria: string | undefined;
    if (c.nome) u.nome = c.nome; if (c.perfil) u.perfil = c.perfil; if (c.ativo !== undefined) u.ativo = c.ativo;
    if (c.todasUnidades !== undefined) u.todasUnidades = c.todasUnidades; if (c.unidadeIds) u.unidadeIds = c.unidadeIds;
    if (c.redefinirSenha) { temporaria = "Demo" + Math.random().toString(36).slice(2, 10) + "7a"; u.senha = temporaria; u.trocarSenha = true; }
    if (c.redefinirMfa) u.totpAtivo = false;
    auditar("USUARIO_ALTERADO", "usuario", u.id, { campos: Object.keys(c) });
    return { usuario: publicoUsuario(u), senhaTemporaria: temporaria };
  }
  // ---------- Perfis, permissões e praças ----------
  if (metodo === "GET" && caminho === "/api/permissoes") { exigir("usuarios:gerenciar"); return TODAS.map((codigo) => ({ codigo, descricao: CATALOGO[codigo], exigeMfa: SENSIVEIS.includes(codigo) })); }
  if (metodo === "GET" && caminho === "/api/perfis") { exigir("usuarios:gerenciar"); return [...perfis].sort((a, b) => Number(b.sistema) - Number(a.sistema) || a.nome.localeCompare(b.nome, "pt-BR")); }
  if (metodo === "POST" && caminho === "/api/perfis") {
    exigir("usuarios:gerenciar");
    const codigo = String(c.codigo ?? "").toUpperCase();
    if (!/^[A-Z0-9_]{2,40}$/.test(codigo) || String(c.nome ?? "").trim().length < 2) throw new Erro(400, "DADOS_INVALIDOS", "Dados inválidos. Revise os campos.");
    if (codigo === "ADMIN") throw new Erro(400, "PERFIL_PROTEGIDO", "Código reservado.");
    if (perfis.some((p) => p.codigo === codigo)) throw new Erro(409, "PERFIL_EXISTE", "Já existe perfil com este código.");
    const permissoes = [...new Set((c.permissoes ?? []) as string[])].filter((x) => x in CATALOGO);
    if (!ehAdmin() && !contido(permissoes, permissoesDe(sessao!.perfil))) throw new Erro(403, "SEM_PERMISSAO", "Você não pode conceder um perfil com mais acesso que o seu.");
    const p: PerfilDemo = { id: id("perfil"), codigo, nome: String(c.nome).trim(), descricao: c.descricao ?? null, permissoes, sistema: false, criadoEm: agoraIso() };
    perfis.push(p); auditar("PERFIL_CRIADO", "perfil", p.id, { codigo, permissoes }); return p;
  }
  if (metodo === "PATCH" && r(/^\/api\/perfis\/([^/]+)$/)) {
    exigir("usuarios:gerenciar");
    const p = achar(perfis, m![1]!, "Perfil");
    if (p.codigo === "ADMIN" && c.permissoes) throw new Erro(400, "PERFIL_PROTEGIDO", "As permissões do perfil Administrador não podem ser alteradas.");
    if (!ehAdmin() && p.sistema) throw new Erro(403, "SEM_PERMISSAO", "Perfis padrão do sistema só podem ser alterados pelo Administrador.");
    if (!ehAdmin() && c.permissoes && !contido(c.permissoes, permissoesDe(sessao!.perfil))) throw new Erro(403, "SEM_PERMISSAO", "Você não pode conceder um perfil com mais acesso que o seu.");
    if (c.nome) p.nome = c.nome; if ("descricao" in c) p.descricao = c.descricao ?? null;
    if (c.permissoes) p.permissoes = [...new Set(c.permissoes as string[])];
    auditar("PERFIL_ALTERADO", "perfil", p.id); return p;
  }
  if (metodo === "GET" && caminho === "/api/unidades") { exigir(); return unidades.filter((u) => podeUnidade(u.id)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")); }
  if (metodo === "POST" && caminho === "/api/unidades") {
    exigir("unidades:gerenciar");
    if (!sessao!.todasUnidades) throw new Erro(403, "SEM_PERMISSAO", "Só quem acessa todas as praças pode criar praças.");
    const codigo = String(c.codigo ?? "").toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(codigo)) throw new Erro(400, "DADOS_INVALIDOS", "Código inválido.");
    if (unidades.some((u) => u.codigo === codigo)) throw new Erro(409, "UNIDADE_EXISTE", "Já existe praça com este código.");
    const u: UnidadeDemo = { id: id("un"), codigo, nome: c.nome, cidade: c.cidade, uf: String(c.uf).toUpperCase(), ativa: c.ativa ?? true, criadoEm: agoraIso() };
    unidades.push(u); auditar("UNIDADE_CRIADA", "unidade", u.id, { codigo }); return u;
  }
  if (metodo === "PATCH" && r(/^\/api\/unidades\/([^/]+)$/)) {
    exigir("unidades:gerenciar");
    if (!sessao!.todasUnidades) throw new Erro(403, "SEM_PERMISSAO", "Só quem acessa todas as praças pode editá-las.");
    const u = achar(unidades, m![1]!, "Praça");
    for (const k of ["nome", "cidade", "uf", "ativa"]) if (k in c) (u as any)[k] = c[k];
    auditar("UNIDADE_ALTERADA", "unidade", u.id); return u;
  }

  // ---------- Pessoas (equipe) ----------
  if (metodo === "GET" && caminho === "/api/pessoas") {
    exigir("pessoas:ver");
    const papel = q.get("papel"), uni = q.get("unidadeId"), todos = q.get("ativos") === "false";
    return pessoas
      .filter((p) => (!papel || p.papeis.includes(papel)) && (!uni || p.unidadeId === uni) && (todos || p.ativo) && (!p.unidadeId || podeUnidade(p.unidadeId)))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map(pessoaPublica);
  }
  if (metodo === "POST" && caminho === "/api/pessoas") {
    exigir("pessoas:gerenciar");
    if (c.unidadeId ? !podeUnidade(c.unidadeId) : !sessao!.todasUnidades) throw new Erro(403, "SEM_PERMISSAO", "Você só pode cadastrar pessoas das suas praças.");
    if (String(c.nome ?? "").trim().length < 2 || !Array.isArray(c.papeis) || c.papeis.length === 0) throw new Erro(400, "DADOS_INVALIDOS", "Informe nome e ao menos um papel.");
    const p: Pessoa = { ...pessoaBase, id: id("pe"), nome: c.nome, papeis: [...new Set(c.papeis as string[])], unidadeId: c.unidadeId ?? null, criadoEm: agoraIso() };
    for (const k of ["telefone", "cnhCategoria", "cnhValidade", "cadasturNumero", "cadasturValidade", "idiomas", "diariaCentavos", "observacoes", "ativo", "documentoTipo", "documento"]) if (k in c) (p as any)[k] = c[k];
    p.email = c.email || null;
    pessoas.push(p); auditar("PESSOA_CRIADA", "pessoa", p.id, { papeis: p.papeis }); return pessoaPublica(p);
  }
  if (metodo === "GET" && caminho === "/api/pessoas/usuarios-disponiveis") {
    exigir("pessoas:gerenciar");
    return usuarios.filter((u) => u.ativo && !pessoas.some((p) => (p as { usuarioId?: string | null }).usuarioId === u.id) && (sessao!.todasUnidades || (!u.todasUnidades && u.unidadeIds.some(podeUnidade)))).map((u) => ({ id: u.id, nome: u.nome, email: u.email }));
  }
  if (r(/^\/api\/pessoas\/([^/]+)$/)) {
    exigir("pessoas:gerenciar");
    const p = achar(pessoas, m![1]!, "Pessoa");
    if (p.unidadeId ? !podeUnidade(p.unidadeId) : !sessao!.todasUnidades) throw new Erro(404, "NAO_ENCONTRADO", "Pessoa não encontrada.");
    if (metodo === "GET") return pessoaPublica(p);
    if (metodo === "PATCH") {
      if ("unidadeId" in c && (c.unidadeId ? !podeUnidade(c.unidadeId) : !sessao!.todasUnidades)) throw new Erro(403, "SEM_PERMISSAO", "Você só pode mover pessoas entre as suas praças.");
      if (c.documentoTipo !== undefined && c.documento === undefined) throw new Erro(400, "DOCUMENTO_INCOMPLETO", "Ao mudar o tipo de documento, informe também o número (ou null para remover).");
      for (const k of ["nome", "papeis", "unidadeId", "telefone", "cnhCategoria", "cnhValidade", "cadasturNumero", "cadasturValidade", "idiomas", "diariaCentavos", "observacoes", "ativo", "documentoTipo", "documento", "usuarioId"]) if (k in c) (p as any)[k] = c[k];
      if ("email" in c) p.email = c.email || null;
      auditar("PESSOA_ALTERADA", "pessoa", p.id, { campos: Object.keys(c) }); return pessoaPublica(p);
    }
  }

  if (metodo === "GET" && caminho === "/api/auditoria") { exigir("auditoria:ver"); return auditoria.slice(0, Number(q.get("limite") ?? 200)); }
  for (const rotear of [rotearFinanceiro, rotearFrota, rotearMarketing, rotearBiblioteca, rotearIa, rotearRastreio, whatsappDemo.rotear, transferDemo.rotear]) {
    const resposta = rotear(ctxModulos, metodo, caminho, q, c);
    if (resposta !== NAO) return resposta;
  }
  throw new Erro(404, "NAO_ENCONTRADO", "Função não disponível na demonstração.");
}

// ---------- Interceptação do fetch ----------
const fetchOriginal = window.fetch.bind(window);
window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  const u = new URL(url, "http://demo.local");
  if (!u.pathname.startsWith("/api/")) return fetchOriginal(entrada, init);
  await new Promise((ok) => setTimeout(ok, 120));
  const metodo = (init?.method ?? "GET").toUpperCase();
  let corpo: Corpo = {};
  try { corpo = init?.body ? JSON.parse(String(init.body)) : {}; } catch { /* corpo vazio */ }
  try {
    const dados = rotear(metodo, u.pathname, u.searchParams, corpo);
    return new Response(JSON.stringify(dados ?? null), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const erro = e instanceof Erro ? e : new Erro(500, "ERRO_INTERNO", "Erro na demonstração.");
    if (!(e instanceof Erro)) console.error(e);
    return new Response(JSON.stringify({ codigo: erro.codigo, mensagem: erro.message }), { status: erro.status, headers: { "Content-Type": "application/json" } });
  }
};
