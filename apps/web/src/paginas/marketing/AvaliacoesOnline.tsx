import { ROTULO_CANAL_AVALIACAO, type CanalAvaliacaoOnline } from "@bybus/core";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { useNotificar } from "../../componentes/Notificacoes";
import { CabecalhoPagina } from "../../componentes/Pagina";
import { useSessao } from "../../sessao/Sessao";
import { useCarregar } from "../../util/useCarregar";

/** Avaliações do Google e do Tripadvisor (dono, 18/11/2026): lidas uma vez por dia; as do Google se respondem por aqui. */
interface Avaliacao {
  id: string; canal: CanalAvaliacaoOnline; unidadeId: string | null; autor: string | null; nota: number; titulo: string | null; texto: string | null;
  idioma: string | null; publicadaEm: string | null; url: string | null; resposta: string | null; respondidaEm: string | null; lida: boolean;
}
interface Resumo {
  unidadeId: string; praca: string; canal: CanalAvaliacaoOnline; configurado: boolean; media: number | null; total: number | null; link: string | null; selo: string | null; erro: string | null;
  guardadas: { quantidade: number; media: number | null; semResposta: number }; novas: number;
}
interface Resposta {
  estado: { google: { configurado: boolean; conectado: boolean; retorno: string | null }; tripadvisor: { configurado: boolean } };
  ultima: { em: string } | null;
  locais: Record<string, { google: string | null; tripadvisor: string | null; nome: string; codigo: string }>;
  resumo: Resumo[];
  itens: Avaliacao[];
}

const estrelas = (n: number) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
const dataHora = (iso: string | null) => (iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short" }).format(new Date(iso)) : "");
const num = (n: number | null) => (n == null ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
const MENSAGEM_GOOGLE: Record<string, { tipo: "sucesso" | "erro" | "atencao"; texto: string }> = {
  conectado: { tipo: "sucesso", texto: "Conta Google conectada. Agora escolha o perfil (local) de cada praça e clique em Atualizar agora." },
  cancelado: { tipo: "atencao", texto: "A conexão com o Google foi cancelada." },
  erro: { tipo: "erro", texto: "Não deu para conectar o Google. Tente de novo, entrando com a conta Google dona do perfil da empresa." },
};

function Responder({ a, aoResponder }: { a: Avaliacao; aoResponder: () => Promise<void> }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState(a.resposta ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  if (!aberto) return <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setAberto(true)}>{a.resposta ? "Editar resposta" : "Responder"}</button>;
  async function enviar() {
    setErro(null); setEnviando(true);
    try { await api.post(`/api/marketing/avaliacoes-online/${a.id}/responder`, { texto: texto.trim() }); setAberto(false); await aoResponder(); }
    catch (x) { setErro(mensagemDeErro(x)); }
    finally { setEnviando(false); }
  }
  return (
    <div className="campo">
      <label htmlFor={`resp-${a.id}`}>Resposta pública no Google</label>
      <textarea id={`resp-${a.id}`} rows={3} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} />
      {erro && <span className="campo__erro" role="alert">{erro}</span>}
      <div className="barra-acoes">
        <button type="button" className="botao botao--primario botao--pequeno" disabled={enviando || texto.trim().length < 2} onClick={() => void enviar()}>{enviando ? "Enviando…" : "Publicar resposta"}</button>
        <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setAberto(false)}>Cancelar</button>
      </div>
    </div>
  );
}

/** Ligar: conectar a conta Google, escolher o perfil de cada praça e conferir o local do Tripadvisor. */
function Configurar({ r, aoMudar }: { r: Resposta; aoMudar: () => Promise<void> }) {
  const [locaisGoogle, setLocaisGoogle] = useState<Array<{ nome: string; titulo: string; conta: string }> | null>(null);
  const [rascunho, setRascunho] = useState(() => Object.fromEntries(Object.entries(r.locais).map(([id, l]) => [id, { google: l.google ?? "", tripadvisor: l.tripadvisor ?? "" }])));
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function conectar() {
    setErro(null);
    try { const { url } = await api.get<{ url: string }>("/api/marketing/google/conectar"); window.location.assign(url); } catch (x) { setErro(mensagemDeErro(x)); }
  }
  async function buscarLocais() {
    setErro(null);
    try { setLocaisGoogle(await api.get("/api/marketing/google/locais")); } catch (x) { setErro(mensagemDeErro(x)); }
  }
  async function salvar() {
    setErro(null); setMsg(null);
    try {
      await api.put("/api/marketing/avaliacoes-online/locais", Object.fromEntries(Object.entries(rascunho).map(([id, l]) => [id, { google: l.google || null, tripadvisor: l.tripadvisor.replace(/\D/g, "") || null }])));
      setMsg("Locais salvos."); await aoMudar();
    } catch (x) { setErro(mensagemDeErro(x)); }
  }
  async function desconectar() {
    if (!window.confirm("Desconectar a conta Google? As avaliações já lidas continuam aqui.")) return;
    try { await api.delete("/api/marketing/google/conexao"); await aoMudar(); } catch (x) { setErro(mensagemDeErro(x)); }
  }
  const { google, tripadvisor } = r.estado;
  return (
    <details className="cartao" open={!google.conectado && !tripadvisor.configurado}>
      <summary><Icone nome="engrenagem" /> Ligar Google e Tripadvisor</summary>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <ol className="mkt-passos">
        <li>
          <strong>Google:</strong>{" "}
          {!google.configurado ? <>falta ligar no servidor (cliente OAuth do Google Cloud, comando <code>ligar-avaliacoes.sh</code>).{google.retorno ? null : " Falta também o endereço público do sistema."}</>
            : google.conectado ? <>conta conectada. <button type="button" className="botao botao--link botao--pequeno" onClick={() => void desconectar()}>Desconectar</button></>
              : <button type="button" className="botao botao--primario botao--pequeno" onClick={() => void conectar()}>Conectar conta Google</button>}
          {google.retorno && !google.conectado && <div className="texto-fraco">Endereço de retorno para cadastrar no Google Cloud: <code>{google.retorno}</code></div>}
        </li>
        <li><strong>Tripadvisor:</strong> {tripadvisor.configurado ? "chave ligada." : <>falta ligar no servidor (chave da API de conteúdo, comando <code>ligar-avaliacoes.sh</code>).</>}</li>
      </ol>
      <div className="mkt-locais">
        {Object.entries(r.locais).map(([id, l]) => (
          <fieldset key={id}>
            <legend>{l.nome}</legend>
            <div className="campo">
              <label htmlFor={`lg-${id}`}>Perfil no Google</label>
              {locaisGoogle ? (
                <select id={`lg-${id}`} value={rascunho[id]!.google} onChange={(e) => setRascunho({ ...rascunho, [id]: { ...rascunho[id]!, google: e.target.value } })}>
                  <option value="">Nenhum</option>
                  {locaisGoogle.map((g) => <option key={g.nome} value={g.nome}>{g.titulo} ({g.conta})</option>)}
                </select>
              ) : (
                <span>{l.google ? "Escolhido" : "Não escolhido"}{google.conectado && <> · <button type="button" className="botao botao--link botao--pequeno" onClick={() => void buscarLocais()}>Escolher</button></>}</span>
              )}
            </div>
            <div className="campo">
              <label htmlFor={`lt-${id}`}>Número do local no Tripadvisor</label>
              <input id={`lt-${id}`} inputMode="numeric" value={rascunho[id]!.tripadvisor} placeholder="ex.: 2362697 (o número depois do -d no link)" onChange={(e) => setRascunho({ ...rascunho, [id]: { ...rascunho[id]!, tripadvisor: e.target.value } })} />
            </div>
          </fieldset>
        ))}
      </div>
      <div className="barra-acoes"><button type="button" className="botao botao--secundario" onClick={() => void salvar()}>Salvar locais</button>{msg && <span role="status">{msg}</span>}</div>
    </details>
  );
}

export function AvaliacoesOnline() {
  const { pode, praca } = useSessao();
  const gerente = pode("marketing:gerenciar");
  const notificar = useNotificar();
  const [busca, setBusca] = useSearchParams();
  const [canal, setCanal] = useState<"" | CanalAvaliacaoOnline>("");
  const [situacao, setSituacao] = useState<"todas" | "novas" | "sem_resposta">("todas");
  const [baixas, setBaixas] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const dados = useCarregar((s) => api.get<Resposta>(`/api/marketing/avaliacoes-online${qs({ unidadeId: praca, canal: canal || undefined, situacao, notaAte: baixas ? "3" : undefined, limite: "200" })}`, s), [praca, canal, situacao, baixas]);
  const r = dados.dados;
  const retornoGoogle = busca.get("google");
  useEffect(() => { if (retornoGoogle) { const t = setTimeout(() => setBusca({}, { replace: true }), 15_000); return () => clearTimeout(t); } }, [retornoGoogle, setBusca]);

  async function atualizar() {
    setErro(null); setAtualizando(true);
    try {
      const s = await api.post<{ resultados: Array<{ ok: boolean; novas?: number; erro?: string; canal: string }> }>("/api/marketing/avaliacoes-online/atualizar");
      const novas = s.resultados.reduce((t, x) => t + (x.novas ?? 0), 0);
      const falhas = s.resultados.filter((x) => !x.ok);
      notificar(falhas.length ? `Atualizado com ${falhas.length} falha(s): ${falhas[0]!.erro}` : `Atualizado: ${novas} avaliação(ões) nova(s).`, falhas.length ? "erro" : "sucesso");
      await dados.recarregar();
    } catch (x) { setErro(mensagemDeErro(x)); }
    finally { setAtualizando(false); }
  }
  async function marcarLidas(ids: string[]) {
    if (!ids.length) return;
    try { await api.post("/api/marketing/avaliacoes-online/lidas", { ids }); await dados.recarregar(); } catch (x) { setErro(mensagemDeErro(x)); }
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Google e Tripadvisor"
        descricao="As avaliações dos clientes nos dois sites, lidas uma vez por dia. As do Google podem ser respondidas por aqui."
        acoes={gerente && r && (r.estado.google.conectado || r.estado.tripadvisor.configurado) && (
          <button type="button" className="botao botao--primario" disabled={atualizando} onClick={() => void atualizar()}><Icone nome="desfazer" /> {atualizando ? "Atualizando…" : "Atualizar agora"}</button>
        )}
      />
      {retornoGoogle && MENSAGEM_GOOGLE[retornoGoogle] && <Aviso tipo={MENSAGEM_GOOGLE[retornoGoogle]!.tipo}>{MENSAGEM_GOOGLE[retornoGoogle]!.texto}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {dados.carregando && !r ? <Carregando /> : dados.erro ? <ErroCarga mensagem={dados.erro} tentarDeNovo={dados.recarregar} /> : r && (
        <>
          {gerente && <Configurar r={r} aoMudar={dados.recarregar} />}
          {r.ultima && <p className="texto-fraco">Última leitura: {new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(r.ultima.em))}</p>}
          <div className="mkt-resumo-avaliacoes">
            {r.resumo.filter((x) => x.configurado).map((x) => (
              <section key={`${x.unidadeId}-${x.canal}`} className="cartao" aria-label={`${ROTULO_CANAL_AVALIACAO[x.canal]} · ${x.praca}`}>
                <h2>{ROTULO_CANAL_AVALIACAO[x.canal]} · {x.praca}</h2>
                {x.erro ? <Aviso tipo="erro">{x.erro}</Aviso> : x.media == null && x.total == null ? (
                  <p className="texto-fraco">Ainda não lido.{gerente ? " Clique em Atualizar agora." : ""}</p>
                ) : (
                  <>
                    <p className="mkt-nota">
                      {x.canal === "TRIPADVISOR" && x.selo ? <img src={x.selo} alt={`Nota ${num(x.media)} no Tripadvisor`} height={20} /> : <span aria-hidden="true">{x.media != null ? estrelas(x.media) : ""}</span>}
                      {" "}<strong>{num(x.media)}</strong> · {x.total == null ? "—" : `${x.total.toLocaleString("pt-BR")} avaliações`}
                    </p>
                    <p className="texto-fraco">{x.novas} nova(s) · {x.guardadas.semResposta} nota(s) até 3 sem resposta</p>
                    {x.link && <a href={x.link} target="_blank" rel="noopener noreferrer">Ver no Tripadvisor</a>}
                  </>
                )}
              </section>
            ))}
          </div>
          <div className="filtros">
            <div className="campo campo--linha">
              <label htmlFor="ao-canal">Site</label>
              <select id="ao-canal" value={canal} onChange={(e) => setCanal(e.target.value as "" | CanalAvaliacaoOnline)}>
                <option value="">Os dois</option><option value="GOOGLE">Google</option><option value="TRIPADVISOR">Tripadvisor</option>
              </select>
            </div>
            <div className="campo campo--linha">
              <label htmlFor="ao-situacao">Mostrar</label>
              <select id="ao-situacao" value={situacao} onChange={(e) => setSituacao(e.target.value as typeof situacao)}>
                <option value="todas">Todas</option><option value="novas">Só as novas</option><option value="sem_resposta">Sem resposta</option>
              </select>
            </div>
            <label className="interruptor"><input type="checkbox" checked={baixas} onChange={(e) => setBaixas(e.target.checked)} /> Só notas até 3</label>
            {r.itens.some((a) => !a.lida) && <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void marcarLidas(r.itens.filter((a) => !a.lida).map((a) => a.id))}>Marcar todas como lidas</button>}
          </div>
          {r.itens.length === 0 ? <Vazio titulo={r.estado.google.conectado || r.estado.tripadvisor.configurado ? "Nenhuma avaliação neste filtro." : "Ligue o Google ou o Tripadvisor para ver as avaliações aqui."} /> : (
            <ul className="mkt-avaliacoes">
              {r.itens.map((a) => (
                <li key={a.id} className={a.lida ? "" : "mkt-avaliacoes--nova"}>
                  <div className="mkt-avaliacoes__topo">
                    <span className={`etiqueta ${a.canal === "GOOGLE" ? "etiqueta--neutra" : "etiqueta--sucesso"}`}>{ROTULO_CANAL_AVALIACAO[a.canal]}</span>
                    <span className="mkt-estrelas" aria-label={`Nota ${a.nota} de 5`}>{estrelas(a.nota)}</span>
                    <span>{a.autor ?? "Anônimo"}</span>
                    <span className="texto-fraco">{dataHora(a.publicadaEm)}</span>
                    {!a.lida && <span className="etiqueta etiqueta--atencao">nova</span>}
                  </div>
                  {a.titulo && <strong>{a.titulo}</strong>}
                  {a.texto ? <p>{a.texto}</p> : <p className="texto-fraco">Só a nota, sem texto.</p>}
                  {a.resposta && <blockquote className="mkt-resposta"><strong>Resposta da By Bus</strong> · {dataHora(a.respondidaEm)}<br />{a.resposta}</blockquote>}
                  <div className="barra-acoes">
                    {a.url && <a className="botao botao--link botao--pequeno" href={a.url} target="_blank" rel="noopener noreferrer">Abrir no {ROTULO_CANAL_AVALIACAO[a.canal]}</a>}
                    {!a.lida && <button type="button" className="botao botao--link botao--pequeno" onClick={() => void marcarLidas([a.id])}>Marcar como lida</button>}
                  </div>
                  {gerente && a.canal === "GOOGLE" && <Responder a={a} aoResponder={dados.recarregar} />}
                  {a.canal === "TRIPADVISOR" && !a.resposta && a.nota <= 3 && <p className="texto-fraco">Responda pelo painel de empresas do Tripadvisor.</p>}
                </li>
              ))}
            </ul>
          )}
          {r.resumo.some((x) => x.canal === "TRIPADVISOR" && x.configurado) && <p className="texto-fraco mkt-atribuicao">Avaliações do Tripadvisor: dados fornecidos pelo Tripadvisor.</p>}
        </>
      )}
    </>
  );
}
