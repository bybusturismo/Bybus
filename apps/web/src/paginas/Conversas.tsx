import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, mensagemDeErro, qs } from "../api/cliente";
import type { WaConversaDetalhe, WaConversaResumo, WaEnvio, WaLista, WaMensagem, WaMensagens, WaModo } from "../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Icone } from "../componentes/Icone";
import { Modal } from "../componentes/Modal";
import { useSessao } from "../sessao/Sessao";
import { FUSO, formatarDataCurta, hojeIso, somarDias } from "../util/formato";
import { useCarregar } from "../util/useCarregar";
import "../estilos/whatsapp.css";

const ATUALIZAR_MS = 10_000;
const LIMITE_TEXTO = 4096;
const TIPO_FILA: Record<string, string> = { CONFIRMACAO: "confirmação", VOUCHER: "voucher", RASTREIO: "rastreio" };
const ROTULO_MIDIA: Record<string, string> = { IMAGEM: "Imagem", AUDIO: "Áudio", DOCUMENTO: "Documento", OUTRO: "Mensagem" };
const SITUACAO: Record<string, string> = { SIMULADA: "simulada", ENVIADA: "enviada", LIDA: "lida", FALHA: "falhou" };

/** Telefone legível: +55 (48) 99999-0000. Número escondido pelo WhatsApp (lid:…) vira um aviso. */
export function formatarTelefone(tel: string): string {
  if (tel.startsWith("lid:")) return "Número oculto pelo WhatsApp";
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(tel);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${tel}`;
}
const titulo = (c: { nome: string | null; telefone: string }) => c.nome || formatarTelefone(c.telefone);

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
  return (
    <li>
      <button type="button" className={`wa-item${ativa ? " wa-item--ativa" : ""}${c.naoLidas ? " wa-item--nova" : ""}`} aria-current={ativa ? "true" : undefined} onClick={aoAbrir}>
        <span className="wa-item__linha">
          <span className="wa-item__nome">{titulo(c)}</span>
          <span className="wa-item__hora">{quandoNaLista(c.ultimaMensagemEm)}</span>
        </span>
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

function Conversa({ id, podeResponder, aoVoltar, aoMudar }: { id: string; podeResponder: boolean; aoVoltar: () => void; aoMudar: () => void }) {
  const detalhe = useCarregar((s) => api.get<WaConversaDetalhe>(`/api/whatsapp/conversas/${id}`, s), [id]);
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
    if (!t || enviando) return;
    setEnviando(true);
    setAviso(null);
    try {
      const r = await api.post<WaEnvio>(`/api/whatsapp/conversas/${id}/responder`, { texto: t });
      setTexto("");
      if (r.status === "FALHA") setAviso("O WhatsApp não aceitou a mensagem. Ela ficou registrada como “falhou”; tente de novo em instantes.");
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
  const cronologico = [...itens].reverse();
  let diaAnterior = "";
  return (
    <section className="wa-conversa" aria-label="Conversa">
      <header className="wa-conversa__topo">
        <button type="button" className="botao botao--fantasma botao--icone wa-voltar" onClick={aoVoltar} aria-label="Voltar para a lista">
          <Icone nome="seta" />
        </button>
        <div className="wa-conversa__quem">
          <strong>{d ? titulo(d) : "…"}</strong>
          {d && d.nome && <span className="texto-fraco">{formatarTelefone(d.telefone)}</span>}
        </div>
      </header>

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
      {podeResponder ? (
        <form className="wa-resposta" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
          <textarea
            aria-label="Mensagem"
            placeholder="Escreva uma mensagem (Enter envia, Shift+Enter quebra a linha)"
            rows={2}
            maxLength={LIMITE_TEXTO}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={aoTeclar}
          />
          <button type="submit" className="botao botao--primario" disabled={enviando || !texto.trim()}>
            <Icone nome="seta" /> Enviar
          </button>
        </form>
      ) : (
        <p className="wa-resposta wa-resposta--so-leitura texto-fraco">Seu perfil pode ler as conversas, mas não responder.</p>
      )}
    </section>
  );
}

export function Whatsapp() {
  const { pode } = useSessao();
  const podeResponder = pode("whatsapp:responder");
  const [params, setParams] = useSearchParams();
  const aberta = params.get("c");
  const [busca, setBusca] = useState("");
  const [soNaoLidas, setSoNaoLidas] = useState(false);
  const [nova, setNova] = useState(false);
  const termo = useAtraso(busca.trim(), 250);
  const lista = useCarregar((s) => api.get<WaLista>(`/api/whatsapp/conversas${qs({ busca: termo, naoLidas: soNaoLidas ? "1" : undefined, limite: 200 })}`, s), [termo, soNaoLidas]);
  useAtualizacao(() => { void lista.recarregar(); });

  const abrir = (id: string | null) => setParams(id ? { c: id } : {}, { replace: false });
  const l = lista.dados;

  return (
    <div className="pagina pagina--whatsapp">
      <div className="pagina__cabecalho">
        <div>
          <h1>WhatsApp</h1>
          <p className="pagina__descricao">Conversas com os clientes: o que chega, o que o sistema envia sozinho e as respostas da equipe.</p>
        </div>
        {podeResponder && (
          <div className="barra-acoes">
            <button type="button" className="botao botao--secundario" onClick={() => setNova(true)}><Icone nome="mais" /> Nova conversa</button>
          </div>
        )}
      </div>
      {l && <AvisosDeModo modo={l.modo} />}

      <div className={`wa${aberta ? " wa--aberta" : ""}`}>
        <aside className="wa-lista" aria-label="Conversas">
          <div className="wa-lista__filtros">
            <input type="search" aria-label="Buscar conversa" placeholder="Buscar por nome ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <label className="wa-lista__nao-lidas">
              <input type="checkbox" checked={soNaoLidas} onChange={(e) => setSoNaoLidas(e.target.checked)} /> Não lidas{l && l.naoLidasTotal > 0 ? ` (${l.naoLidasTotal})` : ""}
            </label>
          </div>
          {lista.carregando && !l ? <Carregando /> : lista.erro && !l ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : l?.conversas.length === 0 ? (
            <Vazio titulo={termo || soNaoLidas ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda."}>
              {!termo && !soNaoLidas && "As conversas aparecem quando um cliente escreve ou quando o sistema envia uma confirmação."}
            </Vazio>
          ) : (
            <ul className="wa-lista__itens">
              {l?.conversas.map((c) => <ItemConversa key={c.id} c={c} ativa={c.id === aberta} aoAbrir={() => abrir(c.id)} />)}
            </ul>
          )}
        </aside>

        {aberta ? (
          <Conversa key={aberta} id={aberta} podeResponder={podeResponder} aoVoltar={() => abrir(null)} aoMudar={() => void lista.recarregar()} />
        ) : (
          <section className="wa-conversa wa-conversa--vazia" aria-label="Conversa">
            <Vazio titulo="Escolha uma conversa" >Clique em uma conversa da lista para ver as mensagens e responder.</Vazio>
          </section>
        )}
      </div>

      {nova && <NovaConversa aoFechar={() => setNova(false)} aoCriar={(id) => { setNova(false); abrir(id); void lista.recarregar(); }} />}
    </div>
  );
}
