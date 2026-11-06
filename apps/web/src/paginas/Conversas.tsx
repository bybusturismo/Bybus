import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, mensagemDeErro, qs } from "../api/cliente";
import { aplicarVariaveis, ETIQUETAS_CONVERSA, ROTULO_ETIQUETA_CONVERSA } from "@bybus/core";
import type { CanalConversa, EtiquetaConversa, WaConversaDetalhe, WaConversaResumo, WaEnvio, WaLista, WaMensagem, WaMensagens, WaModo } from "../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Icone } from "../componentes/Icone";
import { Modal } from "../componentes/Modal";
import { useSessao } from "../sessao/Sessao";
import { FUSO, formatarDataCurta, hojeIso, somarDias } from "../util/formato";
import { useCarregar } from "../util/useCarregar";
import { ComentariosInstagram } from "./conversas/Comentarios";
import { BibliotecaRespostas, filtrarRespostas, SugestoesRespostas, useRespostasProntas, type Resposta } from "./conversas/RespostasProntas";
import "../estilos/conversas.css";

const ATUALIZAR_MS = 10_000;
const LIMITE_TEXTO = 4096;
const TIPO_FILA: Record<string, string> = { CONFIRMACAO: "confirmação", VOUCHER: "voucher", RASTREIO: "rastreio" };
const ROTULO_MIDIA: Record<string, string> = { IMAGEM: "Imagem", AUDIO: "Áudio", DOCUMENTO: "Documento", OUTRO: "Mensagem" };
const SITUACAO: Record<string, string> = { SIMULADA: "simulada", ENVIADA: "enviada", LIDA: "lida", FALHA: "falhou" };

/** Telefone legível: +55 (48) 99999-0000. Número escondido pelo WhatsApp (lid:…) vira um aviso. */
export function formatarTelefone(tel: string): string {
  if (tel.startsWith("ig:")) return "Contato do Instagram";
  if (tel.startsWith("lid:")) return "Número oculto pelo WhatsApp";
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(tel);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${tel}`;
}
const titulo = (c: { nome: string | null; telefone: string }) => c.nome || formatarTelefone(c.telefone);
const ROTULO_CANAL: Record<CanalConversa, string> = { WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram" };
const dosCanais: Array<{ valor: "" | CanalConversa; rotulo: string }> = [{ valor: "", rotulo: "Todos os canais" }, { valor: "WHATSAPP", rotulo: "WhatsApp" }, { valor: "INSTAGRAM", rotulo: "Instagram" }];

/** Ícone do canal (texto acessível junto: o rótulo nunca depende só do ícone). */
function IconeCanal({ canal }: { canal: CanalConversa }) {
  return <span className={`wa-canal wa-canal--${canal.toLowerCase()}`} title={ROTULO_CANAL[canal]}><Icone nome={canal === "INSTAGRAM" ? "camera" : "mensagem"} tamanho={14} /><span className="visualmente-oculto">{ROTULO_CANAL[canal]}</span></span>;
}

function tempoRestante(min: number): string {
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}

const dia = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(d);
const hora = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

/** Hora de hoje, "Ontem" ou dd/mm — para a lista. */
function quandoNaLista(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = hojeIso();
  const do_dia = dia(d);
  if (do_dia === hoje) return hora(d);
  if (do_dia === somarDias(hoje, -1)) return "Ontem";
  return formatarDataCurta(do_dia);
}
function rotuloDoDia(iso: string): string {
  const d = dia(new Date(iso));
  const hoje = hojeIso();
  if (d === hoje) return "Hoje";
  if (d === somarDias(hoje, -1)) return "Ontem";
  return d.split("-").reverse().join("/");
}

function textoDaMensagem(m: Pick<WaMensagem, "tipo" | "texto">): string {
  if (m.tipo === "TEXTO") return m.texto ?? "";
  const rotulo = `[${ROTULO_MIDIA[m.tipo] ?? "Mensagem"}]`;
  return m.texto ? `${rotulo} ${m.texto}` : rotulo;
}
const previaDaLista = (c: WaConversaResumo) =>
  c.previaDirecao === null ? "Sem mensagens" : `${c.previaDirecao === "SAIDA" ? "Você: " : ""}${textoDaMensagem({ tipo: (c.previaTipo ?? "TEXTO") as WaMensagem["tipo"], texto: c.previa })}`;

/** Chama `fn` a cada 10 s enquanto a aba estiver visível. */
function useAtualizacao(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) ref.current(); }, ATUALIZAR_MS);
    return () => clearInterval(t);
  }, []);
}

function useAtraso<T>(valor: T, ms: number): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

function AvisosDeModo({ modo }: { modo: WaModo }) {
  return (
    <>
      {modo.instagram && !modo.instagram.conectado && <Aviso tipo="info" titulo="Instagram não conectado">Os Directs e comentários do Instagram aparecem aqui depois que a conta for conectada (passo a passo em docs/produto/modulo-instagram.md).</Aviso>}
      {modo.instagram?.conectado && modo.instagram.simulado && <Aviso tipo="atencao" titulo="Instagram em modo simulado">Nada é enviado ao Instagram de verdade: respostas e comentários ficam só registrados aqui.</Aviso>}
      {modo.simulado && (
        <Aviso tipo="atencao" titulo="WhatsApp em modo simulado">
          Nada é enviado de verdade: as respostas ficam só registradas aqui.
        </Aviso>
      )}
      {modo.provedor === "evolution" && modo.conexao && modo.conexao !== "open" && (
        <Aviso tipo="erro" titulo="WhatsApp desconectado">O celular precisa ler o QR code de novo na Evolution.</Aviso>
      )}
      {modo.provedor === "evolution" && !modo.avisosLigados && (
        <Aviso tipo="info" titulo="Recebimento desligado">Sem WHATSAPP_WEBHOOK_TOKEN, só aparecem as mensagens que o sistema enviou.</Aviso>
      )}
    </>
  );
}

function NovaConversa({ aoFechar, aoCriar }: { aoFechar: () => void; aoCriar: (id: string) => void }) {
  const [telefone, setTelefone] = useState("");
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function criar(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      const r = await api.post<{ id: string; envio: WaEnvio | null }>("/api/whatsapp/conversas", { telefone: telefone.trim(), ...(texto.trim() ? { texto: texto.trim() } : {}) });
      aoCriar(r.id);
    } catch (e2) {
      setErro(mensagemDeErro(e2));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Modal aberto titulo="Nova conversa" aoFechar={aoFechar}>
      <form onSubmit={criar} noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="campo">
          <label htmlFor="wa-novo-tel">Telefone do cliente</label>
          <input id="wa-novo-tel" inputMode="tel" autoComplete="off" placeholder="(48) 99999-0000" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
          <p className="campo__ajuda">DDD + número. Para estrangeiros, com o código do país (ex.: +54 9 11 5555-0000).</p>
        </div>
        <div className="campo">
          <label htmlFor="wa-novo-texto">Primeira mensagem (opcional)</label>
          <textarea id="wa-novo-texto" rows={3} maxLength={LIMITE_TEXTO} value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
        <div className="modal__acoes">
          <button type="button" className="botao botao--secundario" onClick={aoFechar}>Cancelar</button>
          <button type="submit" className="botao botao--primario" disabled={enviando || telefone.trim().length < 8}>{texto.trim() ? "Abrir e enviar" : "Abrir conversa"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ItemConversa({ c, ativa, aoAbrir }: { c: WaConversaResumo; ativa: boolean; aoAbrir: () => void }) {
  const iniciais = c.atendenteNome ? c.atendenteNome.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() : null;
  return (
    <li>
      <button type="button" className={`wa-item${ativa ? " wa-item--ativa" : ""}${c.naoLidas ? " wa-item--nova" : ""}`} aria-current={ativa ? "true" : undefined} onClick={aoAbrir}>
        <span className="wa-item__linha">
          <span className="wa-item__nome"><IconeCanal canal={c.canal} /> {titulo(c)}</span>
          <span className="wa-item__hora">{quandoNaLista(c.ultimaMensagemEm)}</span>
        </span>
        {(c.etiquetas.length > 0 || iniciais) && (
          <span className="wa-item__marcas">
            {c.etiquetas.map((e) => <span key={e} className="etiqueta etiqueta--neutra">{ROTULO_ETIQUETA_CONVERSA[e]}</span>)}
            {iniciais && <span className="etiqueta etiqueta--info" title={`Atendente: ${c.atendenteNome}`}>{iniciais}</span>}
          </span>
        )}
        <span className="wa-item__linha">
          <span className="wa-item__previa">{previaDaLista(c)}</span>
          {c.naoLidas > 0 && <span className="wa-item__contador" aria-label={`${c.naoLidas} não lidas`}>{c.naoLidas}</span>}
        </span>
      </button>
    </li>
  );
}

function Balao({ m }: { m: WaMensagem }) {
  const saida = m.direcao === "SAIDA";
  return (
    <div className={`wa-balao wa-balao--${saida ? "saida" : "entrada"}${m.status === "FALHA" ? " wa-balao--falha" : ""}`}>
      {m.automatica && <span className="wa-balao__auto">Automática{m.tipoFila ? ` · ${TIPO_FILA[m.tipoFila] ?? m.tipoFila.toLowerCase()}` : ""}</span>}
      <span className="wa-balao__texto">{textoDaMensagem(m)}</span>
      <span className="wa-balao__rodape">
        {saida && m.enviadaPor && <span>{m.enviadaPor.split(" ")[0]} · </span>}
        {hora(new Date(m.criadoEm))}
        {saida && <span className={`wa-balao__situacao${m.status === "FALHA" ? " wa-balao__situacao--falha" : ""}`}> · {SITUACAO[m.status] ?? m.status.toLowerCase()}</span>}
      </span>
    </div>
  );
}

function Conversa({ id, podeResponder, aoVoltar, aoMudar, respostas, atendentes, meuId }: {
  id: string; podeResponder: boolean; aoVoltar: () => void; aoMudar: () => void; respostas: Resposta[]; atendentes: Array<{ id: string; nome: string }>; meuId: string;
}) {
  const detalhe = useCarregar((s) => api.get<WaConversaDetalhe>(`/api/whatsapp/conversas/${id}`, s), [id]);
  const [faltando, setFaltando] = useState<string[]>([]);
  const [itens, setItens] = useState<WaMensagem[]>([]); // mais recentes primeiro (como a API)
  const [temMais, setTemMais] = useState(false);
  const [carregou, setCarregou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const rolagem = useRef<HTMLDivElement>(null);
  const noFim = useRef(true);

  const atualizar = useCallback(async () => {
    try {
      const r = await api.get<WaMensagens>(`/api/whatsapp/conversas/${id}/mensagens${qs({ limite: 50 })}`);
      setItens((antigas) => {
        const novas = new Map(r.itens.map((m) => [m.id, m]));
        const resto = antigas.filter((m) => !novas.has(m.id) && m.criadoEm < (r.itens[r.itens.length - 1]?.criadoEm ?? ""));
        return [...r.itens, ...resto];
      });
      if (!carregou) setTemMais(r.temMais);
      setCarregou(true);
      setErro(null);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }, [id, carregou]);

  useEffect(() => { void atualizar(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useAtualizacao(() => { void atualizar(); void detalhe.recarregar(); });

  // Abrir (ou receber mensagem com a conversa aberta) marca como lida.
  const naoLidas = detalhe.dados?.naoLidas ?? 0;
  useEffect(() => {
    if (!naoLidas) return;
    void api.post(`/api/whatsapp/conversas/${id}/lida`).then(aoMudar).catch(() => {});
  }, [naoLidas, id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = rolagem.current;
    if (el && noFim.current) el.scrollTop = el.scrollHeight;
  }, [itens]);

  async function verAnteriores() {
    const maisAntiga = itens[itens.length - 1]?.criadoEm;
    if (!maisAntiga) return;
    try {
      const r = await api.get<WaMensagens>(`/api/whatsapp/conversas/${id}/mensagens${qs({ limite: 50, antes: maisAntiga })}`);
      noFim.current = false;
      setItens((a) => [...a, ...r.itens.filter((m) => !a.some((x) => x.id === m.id))]);
      setTemMais(r.temMais);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  async function enviar() {
    const t = texto.trim();
    // Com "/" no começo, Enter escolhe a primeira resposta pronta em vez de enviar o atalho.
    if (t.startsWith("/")) {
      const primeira = filtrarRespostas(respostas, t)[0];
      if (primeira) { usarResposta(primeira); return; }
    }
    if (!t || enviando || janelaFechada) return;
    if (/\{(nome|passeio|data|ponto|horario)\}/.test(t)) { setAviso("Complete os trechos entre chaves antes de enviar."); return; }
    setEnviando(true);
    setAviso(null);
    try {
      const r = await api.post<WaEnvio>(`/api/whatsapp/conversas/${id}/responder`, { texto: t });
      setTexto("");
      setFaltando([]);
      if (r.status === "FALHA") setAviso(`O ${d ? ROTULO_CANAL[d.canal] : "canal"} não aceitou a mensagem. Ela ficou registrada como “falhou”; tente de novo em instantes.`);
      noFim.current = true;
      await atualizar();
      aoMudar();
    } catch (e) {
      setAviso(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  }
  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void enviar();
    }
  }

  const d = detalhe.dados;
  const janelaFechada = d?.canal === "INSTAGRAM" && d.janela !== null && !d.janela.aberta;

  async function mudarEtiqueta(e: EtiquetaConversa) {
    if (!d) return;
    const novas = d.etiquetas.includes(e) ? d.etiquetas.filter((x) => x !== e) : [...d.etiquetas, e];
    try { await api.put(`/api/whatsapp/conversas/${id}/etiquetas`, { etiquetas: novas }); await detalhe.recarregar(); aoMudar(); } catch (x) { setAviso(mensagemDeErro(x)); }
  }
  async function atribuir(usuarioId: string | null) {
    try { await api.post(`/api/whatsapp/conversas/${id}/atribuir`, { usuarioId }); await detalhe.recarregar(); aoMudar(); } catch (x) { setAviso(mensagemDeErro(x)); }
  }
  /** Insere a resposta pronta na caixa, com as variáveis da reserva; o que faltar fica entre chaves para completar. */
  function usarResposta(r: Resposta) {
    const v = d?.variaveis;
    const aplicada = aplicarVariaveis(r.texto, { nome: v?.nome, passeio: v?.passeio, data: v?.data, ponto: v?.ponto, horario: v?.horario });
    setTexto(aplicada.texto);
    setFaltando(aplicada.faltando);
  }
  const cronologico = [...itens].reverse();
  let diaAnterior = "";
  return (
    <section className="wa-conversa" aria-label="Conversa">
      <header className="wa-conversa__topo">
        <button type="button" className="botao botao--fantasma botao--icone wa-voltar" onClick={aoVoltar} aria-label="Voltar para a lista">
          <Icone nome="seta" />
        </button>
        <div className="wa-conversa__quem">
          <strong>{d ? <><IconeCanal canal={d.canal} /> {titulo(d)}</> : "…"}</strong>
          {d && d.nome && <span className="texto-fraco">{d.canal === "INSTAGRAM" ? "Instagram" : formatarTelefone(d.telefone)}</span>}
        </div>
      </header>

      {d && (
        <div className="wa-gestao" aria-label="Etiquetas e atendente">
          <div className="wa-etiquetas" role="group" aria-label="Etiquetas">
            {ETIQUETAS_CONVERSA.map((e) => (
              <button key={e} type="button" className={`wa-etiqueta${d.etiquetas.includes(e) ? " wa-etiqueta--ativa" : ""}`} aria-pressed={d.etiquetas.includes(e)} disabled={!podeResponder} onClick={() => void mudarEtiqueta(e)}>{ROTULO_ETIQUETA_CONVERSA[e]}</button>
            ))}
          </div>
          <div className="wa-atendente">
            <label htmlFor="wa-atendente">Atendente</label>
            <select id="wa-atendente" value={d.atendenteId ?? ""} disabled={!podeResponder} onChange={(e) => void atribuir(e.target.value || null)}>
              <option value="">Sem atendente</option>
              {atendentes.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
            {podeResponder && d.atendenteId !== meuId && <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void atribuir(meuId)}>Assumir</button>}
          </div>
        </div>
      )}

      {d?.canal === "INSTAGRAM" && d.janela && (
        d.janela.aberta
          ? <p className="wa-janela texto-fraco">Instagram: você pode responder por mais {tempoRestante(d.janela.minutosRestantes)} (regra de 24 horas da Meta, contada da última mensagem do cliente).</p>
          : <Aviso tipo="atencao" titulo="Janela de 24 horas encerrada">Já se passaram mais de 24 horas desde a última mensagem do cliente: o Instagram não permite mais responder por aqui. Quando o cliente escrever de novo, a resposta é liberada.</Aviso>
      )}

      {d && (
        <div className="wa-reservas" aria-label="Reservas deste contato">
          {d.reservas.length === 0 ? (
            <span className="etiqueta etiqueta--neutra">Contato sem reserva</span>
          ) : (
            d.reservas.map((r) => (
              <Link key={r.reservaId} className="wa-reserva" to={`/saidas/${r.saidaId}`}>
                <span className="wa-reserva__data">{formatarDataCurta(r.data)}</span>
                <span>{r.passeio}</span>
                <span className="texto-fraco">{r.titular} · {r.passageiros} pax{r.proxima ? " · próxima" : ""}</span>
              </Link>
            ))
          )}
        </div>
      )}

      <div
        className="wa-mensagens"
        ref={rolagem}
        onScroll={(e) => { const el = e.currentTarget; noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
      >
        {!carregou && !erro ? <Carregando /> : erro && !carregou ? <ErroCarga mensagem={erro} tentarDeNovo={() => void atualizar()} /> : (
          <>
            {temMais && <button type="button" className="botao botao--secundario botao--pequeno wa-mais" onClick={() => void verAnteriores()}>Ver mensagens anteriores</button>}
            {cronologico.length === 0 && <Vazio titulo="Nenhuma mensagem ainda." />}
            {cronologico.map((m) => {
              const rotulo = rotuloDoDia(m.criadoEm);
              const separador = rotulo !== diaAnterior;
              diaAnterior = rotulo;
              return (
                <div key={m.id} className="wa-linha">
                  {separador && <div className="wa-dia"><span>{rotulo}</span></div>}
                  <Balao m={m} />
                </div>
              );
            })}
          </>
        )}
      </div>

      {aviso && <Aviso tipo="erro">{aviso}</Aviso>}
      {faltando.length > 0 && <p className="wa-faltando">Complete antes de enviar: {faltando.map((f) => `{${f}}`).join(", ")} (não há reserva com essa informação).</p>}
      {podeResponder ? (
        <form className="wa-resposta" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
          {texto.startsWith("/") && <SugestoesRespostas respostas={respostas} consulta={texto} aoEscolher={usarResposta} />}
          <textarea
            aria-label="Mensagem"
            placeholder={janelaFechada ? "Janela de 24 horas encerrada" : "Escreva uma mensagem (Enter envia, / abre as respostas prontas)"}
            rows={2}
            maxLength={LIMITE_TEXTO}
            value={texto}
            disabled={janelaFechada}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={aoTeclar}
          />
          <button type="submit" className="botao botao--primario" disabled={enviando || !texto.trim() || janelaFechada}>
            <Icone nome="seta" /> Enviar
          </button>
        </form>
      ) : (
        <p className="wa-resposta wa-resposta--so-leitura texto-fraco">Seu perfil pode ler as conversas, mas não responder.</p>
      )}
    </section>
  );
}

export function Conversas() {
  const { pode, usuario } = useSessao();
  const podeResponder = pode("whatsapp:responder");
  const [params, setParams] = useSearchParams();
  const aberta = params.get("c");
  const [busca, setBusca] = useState("");
  const [soNaoLidas, setSoNaoLidas] = useState(false);
  const [nova, setNova] = useState(false);
  const [biblioteca, setBiblioteca] = useState(false);
  const [canal, setCanal] = useState<"" | CanalConversa>("");
  const [etiqueta, setEtiqueta] = useState<"" | EtiquetaConversa>("");
  const [quem, setQuem] = useState<"" | "eu" | "sem">("");
  const aba = params.get("aba") === "comentarios" ? "comentarios" : "mensagens";
  const termo = useAtraso(busca.trim(), 250);
  const lista = useCarregar((s) => api.get<WaLista>(`/api/whatsapp/conversas${qs({ busca: termo, naoLidas: soNaoLidas ? "1" : undefined, canal, etiqueta, atendente: quem, limite: 200 })}`, s), [termo, soNaoLidas, canal, etiqueta, quem]);
  const respostas = useRespostasProntas();
  const atendentes = useCarregar((s) => api.get<Array<{ id: string; nome: string }>>("/api/whatsapp/atendentes", s), []);
  useAtualizacao(() => { void lista.recarregar(); });
  const filtrando = !!(termo || soNaoLidas || canal || etiqueta || quem);

  const abrir = (id: string | null) => setParams(id ? { c: id } : {}, { replace: false });
  const trocarAba = (a: "mensagens" | "comentarios") => setParams(a === "comentarios" ? { aba: "comentarios" } : {}, { replace: false });
  const l = lista.dados;

  return (
    <div className="pagina pagina--whatsapp">
      <div className="pagina__cabecalho">
        <div>
          <h1>Conversas</h1>
          <p className="pagina__descricao">WhatsApp e Instagram: o que chega, o que o sistema envia sozinho e as respostas da equipe.</p>
        </div>
        <div className="barra-acoes">
          {podeResponder && <button type="button" className="botao botao--fantasma" onClick={() => setBiblioteca(true)}><Icone nome="lista" /> Respostas prontas</button>}
          {podeResponder && aba === "mensagens" && <button type="button" className="botao botao--secundario" onClick={() => setNova(true)}><Icone nome="mais" /> Nova conversa</button>}
        </div>
      </div>
      {l && <AvisosDeModo modo={l.modo} />}
      <div className="abas" role="tablist" aria-label="Conversas">
        <button type="button" role="tab" aria-selected={aba === "mensagens"} className={`aba${aba === "mensagens" ? " aba--ativa" : ""}`} onClick={() => trocarAba("mensagens")}>Mensagens{l && l.naoLidasTotal > 0 ? ` (${l.naoLidasTotal})` : ""}</button>
        <button type="button" role="tab" aria-selected={aba === "comentarios"} className={`aba${aba === "comentarios" ? " aba--ativa" : ""}`} onClick={() => trocarAba("comentarios")}>Comentários do Instagram</button>
      </div>
      {aba === "comentarios" ? <ComentariosInstagram podeResponder={podeResponder} /> : <>

      <div className={`wa${aberta ? " wa--aberta" : ""}`}>
        <aside className="wa-lista" aria-label="Conversas">
          <div className="wa-lista__filtros">
            <input type="search" aria-label="Buscar conversa" placeholder="Buscar por nome ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <div className="wa-lista__selects">
              <select aria-label="Canal" value={canal} onChange={(e) => setCanal(e.target.value as "" | CanalConversa)}>{dosCanais.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}</select>
              <select aria-label="Etiqueta" value={etiqueta} onChange={(e) => setEtiqueta(e.target.value as "" | EtiquetaConversa)}><option value="">Todas as etiquetas</option>{ETIQUETAS_CONVERSA.map((e) => <option key={e} value={e}>{ROTULO_ETIQUETA_CONVERSA[e]}</option>)}</select>
            </div>
            <div className="wa-lista__quem" role="group" aria-label="Atendente">
              <button type="button" className={`wa-filtro${quem === "" ? " wa-filtro--ativo" : ""}`} aria-pressed={quem === ""} onClick={() => setQuem("")}>Todas</button>
              <button type="button" className={`wa-filtro${quem === "eu" ? " wa-filtro--ativo" : ""}`} aria-pressed={quem === "eu"} onClick={() => setQuem("eu")}>Minhas conversas{l ? ` (${l.minhasConversas})` : ""}</button>
              <button type="button" className={`wa-filtro${quem === "sem" ? " wa-filtro--ativo" : ""}`} aria-pressed={quem === "sem"} onClick={() => setQuem("sem")}>Sem atendente</button>
            </div>
            <label className="wa-lista__nao-lidas">
              <input type="checkbox" checked={soNaoLidas} onChange={(e) => setSoNaoLidas(e.target.checked)} /> Não lidas{l && l.naoLidasTotal > 0 ? ` (${l.naoLidasTotal})` : ""}
            </label>
          </div>
          {lista.carregando && !l ? <Carregando /> : lista.erro && !l ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : l?.conversas.length === 0 ? (
            <Vazio titulo={filtrando ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda."}>
              {!filtrando && "As conversas aparecem quando um cliente escreve ou quando o sistema envia uma confirmação."}
            </Vazio>
          ) : (
            <ul className="wa-lista__itens">
              {l?.conversas.map((c) => <ItemConversa key={c.id} c={c} ativa={c.id === aberta} aoAbrir={() => abrir(c.id)} />)}
            </ul>
          )}
        </aside>

        {aberta ? (
          <Conversa key={aberta} id={aberta} podeResponder={podeResponder} aoVoltar={() => abrir(null)} aoMudar={() => void lista.recarregar()} respostas={respostas.dados ?? []} atendentes={atendentes.dados ?? []} meuId={usuario?.id ?? ""} />
        ) : (
          <section className="wa-conversa wa-conversa--vazia" aria-label="Conversa">
            <Vazio titulo="Escolha uma conversa" >Clique em uma conversa da lista para ver as mensagens e responder.</Vazio>
          </section>
        )}
      </div>

      </>}

      {biblioteca && <BibliotecaRespostas aoFechar={() => setBiblioteca(false)} aoMudar={() => void respostas.recarregar()} />}
      {nova && <NovaConversa aoFechar={() => setNova(false)} aoCriar={(id) => { setNova(false); abrir(id); void lista.recarregar(); }} />}
    </div>
  );
}
