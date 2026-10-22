/**
 * MODO DEMONSTRAÇÃO — API simulada no navegador, com dados 100% fictícios.
 * Usa as mesmas regras do sistema (@bybus/core): ordem de embarque, alertas, deduplicação e importação.
 * Nada é enviado a servidor; tudo se perde ao recarregar a página.
 */
import {
  PONTOS_TODA_ILHA, detectarDuplicatas, documentoValido, formatarCpf, lerCsvPaytour, lerEmailBokun, mascararDocumento,
  montarManifesto, normalizarDocumento, type Canal, type Categoria, type ReservaImportada, type TipoDocumento,
} from "@bybus/core";

type Perfil = "ADMIN" | "SUPERVISOR" | "ATENDENTE" | "GUIA" | "MOTORISTA";
const TODAS = ["usuarios:gerenciar", "auditoria:ver", "pontos:gerenciar", "saidas:gerenciar", "saidas:decidir", "reservas:editar", "importacoes:executar", "manifesto:ver", "manifesto:documentos", "manifesto:contatos", "embarque:registrar"];
const PERMISSOES: Record<Perfil, string[]> = {
  ADMIN: TODAS,
  SUPERVISOR: TODAS.filter((p) => p !== "usuarios:gerenciar"),
  ATENDENTE: ["saidas:gerenciar", "reservas:editar", "importacoes:executar", "manifesto:ver", "manifesto:contatos"],
  GUIA: ["manifesto:ver", "manifesto:contatos", "embarque:registrar"],
  MOTORISTA: ["manifesto:ver"],
};
export const SENHA_DEMO = "Bybus-teste-2026";

let seq = 1;
const id = (p: string) => `${p}-${(seq++).toString(36)}`;
const agoraIso = () => new Date().toISOString();
const dataMais = (dias: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + dias * 86400_000));

interface Usuario { id: string; nome: string; email: string; perfil: Perfil; ativo: boolean; totpAtivo: boolean; trocarSenha: boolean; criadoEm: string; senha: string }
interface Pax { id: string; reservaId: string; nome: string; categoria: Categoria; documentoTipo: TipoDocumento | null; documento: string | null; documentoPais: string | null; pontoEmbarqueId: string | null; embarque: "PENDENTE" | "EMBARCOU" | "NO_SHOW"; seq: number }
interface Reserva { id: string; saidaId: string; canal: Canal; canalOrigem: Canal; codigoExterno: string | null; referencias: string[]; contatoNome: string; contatoTelefone: string | null; contatoEmail: string | null; pontoEmbarqueId: string | null; status: "CONFIRMADA" | "CANCELADA"; observacoes: string | null; origem: string; criadoEm: string; atualizadoEm: string }
interface Saida { id: string; passeioId: string; data: string; status: "PREVISTA" | "CONFIRMADA" | "CANCELADA" | "REALIZADA"; capacidade: number; veiculo: string | null; guia: string | null; motorista: string | null; observacoes: string | null; criadoEm: string }

const usuarios: Usuario[] = ([
  ["Admin Demo", "admin@bybus.test", "ADMIN"], ["Supervisora Demo", "supervisor@bybus.test", "SUPERVISOR"],
  ["Atendente Demo", "atendente@bybus.test", "ATENDENTE"], ["Guia Demo", "guia@bybus.test", "GUIA"], ["Motorista Demo", "motorista@bybus.test", "MOTORISTA"],
] as const).map(([nome, email, perfil]) => ({ id: id("u"), nome, email, perfil, ativo: true, totpAtivo: false, trocarSenha: false, criadoEm: agoraIso(), senha: SENHA_DEMO }));

const passeio = { id: "toda-ilha", codigo: "TODA_ILHA", nome: "City Tour Toda Ilha", cidade: "Florianópolis", capacidadePadrao: 73, minimoConfirmacao: 12, minimoSupervisor: 10, ativo: true };
const pontos = PONTOS_TODA_ILHA.map((p, i) => ({ ...p, id: `ponto-${i + 1}`, passeioId: passeio.id, ativo: true }));
const saidas: Saida[] = [];
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
    const saida: Saida = { id: `saida-${dia}`, passeioId: passeio.id, data: dataMais(dia), status, capacidade: 73, veiculo: "QJQ2A16 (fictício)", guia: dia === 0 ? "Guia Fictícia Ana" : null, motorista: dia === 0 ? "Motorista Fictício Davi" : null, observacoes: null, criadoEm: agoraIso() };
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
})();

// ---------- Utilidades ----------
class Erro extends Error { constructor(public status: number, public codigo: string, msg: string) { super(msg); } }
const pode = (perm: string) => !!sessao && PERMISSOES[sessao.perfil].includes(perm);
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
  const ativas = reservas.filter((r) => r.saidaId === s.id && r.status === "CONFIRMADA");
  const ps = pax.filter((p) => ativas.some((r) => r.id === p.reservaId));
  return {
    ...s, passeio: passeio.nome, reservas: ativas.length, passageiros: ps.length,
    assentos: ps.filter((p) => p.categoria !== "COLO").length, pagantes: ps.filter((p) => p.categoria !== "COLO" && p.categoria !== "CORTESIA").length,
  };
}
function manifesto(saidaId: string, completos: boolean) {
  const s = achar(saidas, saidaId, "Saída");
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
        let s = saidas.find((x) => x.data === item.data);
        if (!s) { s = { id: id("saida"), passeioId: passeio.id, data: item.data, status: "PREVISTA", capacidade: 73, veiculo: null, guia: null, motorista: null, observacoes: null, criadoEm: agoraIso() }; saidas.push(s); }
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
const publicoUsuario = (u: Usuario) => { const { senha: _s, ...r } = u; return r; };

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
  if (metodo === "GET" && caminho === "/api/auth/eu") { exigir(); return { usuario: publicoUsuario(sessao!), pendencia: sessao!.trocarSenha ? "TROCAR_SENHA" : null, permissoes: PERMISSOES[sessao!.perfil] }; }
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

  if (metodo === "GET" && caminho === "/api/passeios") { exigir("manifesto:ver"); return [passeio]; }
  if (metodo === "GET" && r(/^\/api\/passeios\/([^/]+)\/pontos$/)) { exigir("manifesto:ver"); return pontos; }

  if (metodo === "GET" && caminho === "/api/saidas") {
    exigir("manifesto:ver");
    const de = q.get("de") ?? "0000", ate = q.get("ate") ?? "9999";
    return saidas.filter((s) => s.data >= de && s.data <= ate).sort((a, b) => a.data.localeCompare(b.data)).map(resumoSaida);
  }
  if (metodo === "POST" && caminho === "/api/saidas") {
    exigir("saidas:gerenciar");
    if (saidas.some((s) => s.data === c.data)) throw new Erro(409, "SAIDA_EXISTE", "Já existe saída deste passeio nesta data.");
    const s: Saida = { id: id("saida"), passeioId: passeio.id, data: c.data, status: "PREVISTA", capacidade: c.capacidade ?? 73, veiculo: c.veiculo ?? null, guia: null, motorista: null, observacoes: null, criadoEm: agoraIso() };
    saidas.push(s); auditar("SAIDA_CRIADA", "saida", s.id); return s;
  }
  if (r(/^\/api\/saidas\/([^/]+)$/)) {
    const s = achar(saidas, m![1]!, "Saída");
    if (metodo === "GET") { exigir("manifesto:ver"); return { saida: s, passeio }; }
    if (metodo === "PATCH") {
      exigir("saidas:gerenciar");
      if (c.status !== undefined && !pode("saidas:decidir")) throw new Erro(403, "SEM_PERMISSAO", "Mudar o status da saída é decisão do supervisor.");
      Object.assign(s, Object.fromEntries(Object.entries(c).filter(([k]) => ["status", "capacidade", "veiculo", "guia", "motorista", "observacoes"].includes(k))));
      auditar("SAIDA_ALTERADA", "saida", s.id, { campos: Object.keys(c) }); return s;
    }
  }
  if (metodo === "GET" && r(/^\/api\/saidas\/([^/]+)\/manifesto$/)) {
    exigir("manifesto:ver");
    const completos = q.get("documentos") === "completos";
    if (completos && !pode("manifesto:documentos")) throw new Erro(403, "SEM_PERMISSAO", "Seu perfil não pode ver documentos completos.");
    auditar(completos ? "MANIFESTO_DOCUMENTOS_COMPLETOS" : "MANIFESTO_VISUALIZADO", "saida", m![1]);
    return manifesto(m![1]!, completos);
  }
  if (r(/^\/api\/saidas\/([^/]+)\/reservas$/)) {
    const s = achar(saidas, m![1]!, "Saída");
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
  if (caminho === "/api/usuarios" && metodo === "GET") { exigir("usuarios:gerenciar"); return usuarios.map(publicoUsuario); }
  if (caminho === "/api/usuarios" && metodo === "POST") {
    exigir("usuarios:gerenciar");
    if (usuarios.some((u) => u.email === String(c.email).toLowerCase())) throw new Erro(409, "EMAIL_EM_USO", "Já existe um usuário com este e-mail.");
    const temporaria = "Demo" + Math.random().toString(36).slice(2, 10) + "7a";
    const u: Usuario = { id: id("u"), nome: c.nome, email: String(c.email).toLowerCase(), perfil: c.perfil, ativo: true, totpAtivo: false, trocarSenha: true, criadoEm: agoraIso(), senha: temporaria };
    usuarios.push(u); auditar("USUARIO_CRIADO", "usuario", u.id, { perfil: u.perfil });
    return { usuario: publicoUsuario(u), senhaTemporaria: temporaria };
  }
  if (metodo === "PATCH" && r(/^\/api\/usuarios\/([^/]+)$/)) {
    exigir("usuarios:gerenciar");
    const u = achar(usuarios, m![1]!, "Usuário");
    if (u.id === sessao!.id && (c.ativo === false || c.perfil)) throw new Erro(400, "AUTO_ALTERACAO", "Você não pode alterar o próprio perfil ou status.");
    let temporaria: string | undefined;
    if (c.nome) u.nome = c.nome; if (c.perfil) u.perfil = c.perfil; if (c.ativo !== undefined) u.ativo = c.ativo;
    if (c.redefinirSenha) { temporaria = "Demo" + Math.random().toString(36).slice(2, 10) + "7a"; u.senha = temporaria; u.trocarSenha = true; }
    if (c.redefinirMfa) u.totpAtivo = false;
    auditar("USUARIO_ALTERADO", "usuario", u.id, { campos: Object.keys(c) });
    return { usuario: publicoUsuario(u), senhaTemporaria: temporaria };
  }
  if (metodo === "GET" && caminho === "/api/auditoria") { exigir("auditoria:ver"); return auditoria.slice(0, Number(q.get("limite") ?? 200)); }
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
