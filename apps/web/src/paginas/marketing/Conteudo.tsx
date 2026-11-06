import { useRef, useState, type FormEvent } from "react";
import { ROTULO_TIPO_POST, TIPOS_POST_INSTAGRAM, type TipoPostInstagram } from "@bybus/core";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { enviarArquivo } from "../../api/envio";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { Confirmar, Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { formatarData, formatarDataHora } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { SeletorBanco } from "./BancoMidias";
import { ROTULO_REDE, ROTULO_STATUS_CONTEUDO } from "./comum";

export interface Conteudo {
  id: string; unidadeId: string | null; titulo: string; rede: string; status: string; dataPrevista: string | null;
  legenda: string | null; link: string | null; responsavelId: string | null; responsavel: string | null;
  tipoPost: string | null; agendarEm: string | null; pubStatus: "AGENDADO" | "PUBLICANDO" | "PUBLICADO" | "FALHOU" | null; pubSimulado: boolean; pubErro: string | null; qtdMidias: number;
}
interface Responsavel { id: string; nome: string }
interface Midia { previa?: string; id: string; nome: string; tipo: string; uso: "IMAGEM" | "VIDEO"; tamanho: number; ordem: number }
type Legendas = { ligada: false; mensagem: string } | { ligada: true; opcoes: Array<{ legenda: string; hashtags: string[] }>; custoUsd: number };

const CLASSE_STATUS: Record<string, string> = { IDEIA: "etiqueta--neutra", PRODUCAO: "etiqueta--neutra", EM_APROVACAO: "etiqueta--atencao", APROVADO: "etiqueta--info", AGENDADO: "etiqueta--info", PUBLICADO: "etiqueta--sucesso" };
const MOTIVOS: Record<string, string> = {
  CONTEUDO_INVALIDO: "o post ficou incompleto (confira mídia e tipo)", URL_PUBLICA_AUSENTE: "o sistema ainda não tem endereço público (URL_PUBLICA)",
  INTERROMPIDO_CONFIRA_NO_INSTAGRAM: "a publicação foi interrompida; confira no Instagram antes de reagendar",
};
const motivo = (c: string | null) => (c ? MOTIVOS[c] ?? (c.startsWith("META_") ? `o Instagram recusou (código ${c.slice(5)})` : c) : "");

/** "2026-11-12T10:30" digitado (horário de Brasília) → instante ISO com o fuso de São Paulo. */
const paraIso = (local: string) => new Date(`${local}:00-03:00`).toISOString();

function SituacaoPublicacao({ c }: { c: Conteudo }) {
  if (c.rede !== "INSTAGRAM" || !c.pubStatus) return null;
  const quando = c.agendarEm ? formatarDataHora(c.agendarEm) : "";
  const texto = c.pubStatus === "AGENDADO" ? `Publica em ${quando}` : c.pubStatus === "PUBLICANDO" ? "Publicando agora…" : c.pubStatus === "PUBLICADO" ? (c.pubSimulado ? "Publicado (simulado)" : "Publicado no Instagram") : `Falhou: ${motivo(c.pubErro)}`;
  return <span className={`publicacao${c.pubStatus === "FALHOU" ? " texto-perigo" : " texto-fraco"}`}>{c.tipoPost ? `${ROTULO_TIPO_POST[c.tipoPost as TipoPostInstagram] ?? c.tipoPost} · ` : ""}{texto}</span>;
}

function MidiasDoPost({ conteudo, aoMudar }: { conteudo: Conteudo; aoMudar: () => Promise<void> }) {
  const notificar = useNotificar();
  const lista = useCarregar((s) => api.get<Midia[]>(`/api/marketing/conteudos/${conteudo.id}/midias`, s), [conteudo.id]);
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [banco, setBanco] = useState(false);
  const bloqueado = conteudo.pubStatus === "PUBLICANDO" || conteudo.status === "PUBLICADO";

  async function atualizar() { await lista.recarregar(); await aoMudar(); }
  async function enviar(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setEnviando(true);
    for (const a of Array.from(arquivos)) {
      try { await enviarArquivo(`/api/marketing/conteudos/${conteudo.id}/midias${qs({ nome: a.name })}`, a); } catch (e) { notificar(`${a.name}: ${mensagemDeErro(e)}`, "erro"); }
    }
    if (entrada.current) entrada.current.value = "";
    setEnviando(false);
    await atualizar();
  }
  async function remover(m: Midia) {
    try { await api.delete(`/api/marketing/conteudos/${conteudo.id}/midias/${m.id}`); await atualizar(); } catch (e) { notificar(mensagemDeErro(e), "erro"); }
  }
  const itens = lista.dados ?? [];
  return (
    <fieldset className="campo campo--largo">
      <legend>Mídia do post</legend>
      {itens.length > 0 && (
        <ul className="midias-post" aria-label="Mídias anexadas">
          {itens.map((m, i) => (
            <li key={m.id} className="midias-post__item">
              {m.uso === "VIDEO" && !m.previa
                ? <video className="banco__midia" src={`/api/marketing/conteudos/${conteudo.id}/midias/${m.id}`} preload="metadata" muted aria-label={m.nome} />
                : <img className="banco__midia" src={m.previa ?? `/api/marketing/conteudos/${conteudo.id}/midias/${m.id}`} alt={m.nome} />}
              <span>{i + 1}. {m.uso === "VIDEO" ? "Vídeo" : "Imagem"}</span>
              {!bloqueado && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void remover(m)} aria-label={`Remover ${m.nome}`}><Icone nome="x" tamanho={14} /> Remover</button>}
            </li>
          ))}
        </ul>
      )}
      {!bloqueado && (
        <div className="barra-acoes">
          <input ref={entrada} type="file" multiple accept="image/jpeg,video/mp4" aria-label="Anexar imagem JPEG ou vídeo MP4" disabled={enviando} onChange={(e) => void enviar(e.target.files)} />
          <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setBanco(true)}>Escolher do banco de mídias</button>
        </div>
      )}
      <p className="campo__ajuda">Instagram: imagem JPEG (até 8 MB) ou vídeo MP4 (até 100 MB); carrossel de 2 a 10 itens. Mexer na mídia de um post aprovado exige nova aprovação.</p>
      {banco && <SeletorBanco aoFechar={() => setBanco(false)} aoEscolher={async (i) => {
        try { await api.post(`/api/marketing/conteudos/${conteudo.id}/midias/do-banco`, { bancoId: i.id }); setBanco(false); await atualizar(); } catch (e) { notificar(mensagemDeErro(e), "erro"); }
      }} />}
    </fieldset>
  );
}

function SugerirLegenda({ rede, titulo, aoUsar }: { rede: string; titulo: string; aoUsar: (texto: string) => void }) {
  const [idioma, setIdioma] = useState<"pt" | "en" | "es">("pt");
  const [briefing, setBriefing] = useState(titulo);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [r, setR] = useState<Legendas | null>(null);
  if (rede !== "INSTAGRAM") return null;
  async function sugerir() {
    setErro(null);
    setCarregando(true);
    try { setR(await api.post<Legendas>("/api/marketing/legendas/sugerir", { briefing: briefing.trim(), idioma })); } catch (e) { setErro(mensagemDeErro(e)); } finally { setCarregando(false); }
  }
  return (
    <fieldset className="campo campo--largo">
      <legend>Sugerir legenda com IA</legend>
      <div className="barra-acoes">
        <div className="campo campo--linha"><label htmlFor="lg-idioma">Idioma</label><select id="lg-idioma" value={idioma} onChange={(e) => setIdioma(e.target.value as "pt" | "en" | "es")}><option value="pt">Português</option><option value="en">English</option><option value="es">Español</option></select></div>
        <div className="campo campo--linha campo--largo"><label htmlFor="lg-briefing">Ideia do post</label><input id="lg-briefing" value={briefing} maxLength={800} onChange={(e) => setBriefing(e.target.value)} placeholder="Ex.: pôr do sol visto da Lagoa da Conceição" /></div>
        <button type="button" className="botao botao--secundario" disabled={carregando || briefing.trim().length < 3} onClick={() => void sugerir()}><Icone nome="faisca" /> {carregando ? "Pensando…" : "Sugerir legenda"}</button>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {r && !r.ligada && <Aviso tipo="info" titulo="IA desligada">{r.mensagem}</Aviso>}
      {r?.ligada && (
        <ul className="legendas-ia" aria-label="Opções de legenda">
          {r.opcoes.map((o, i) => (
            <li key={i} className="legendas-ia__opcao">
              <p>{o.legenda}</p>
              <p className="texto-fraco">{o.hashtags.join(" ")}</p>
              <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => aoUsar(`${o.legenda}\n\n${o.hashtags.join(" ")}`)}>Usar esta legenda</button>
            </li>
          ))}
        </ul>
      )}
      <p className="campo__ajuda">Só a ideia acima vai para a IA (nenhum dado de cliente). Sempre revise o texto antes de aprovar.</p>
    </fieldset>
  );
}

function FormConteudo({ conteudo, responsaveis, aoSalvar, aoCancelar, aoMudarMidia }: {
  conteudo: Conteudo | null; responsaveis: Responsavel[]; aoSalvar: (salvo: Conteudo, criado: boolean) => Promise<void>; aoCancelar: () => void; aoMudarMidia: () => Promise<void>;
}) {
  const { unidades, praca, usuario } = useSessao();
  const todas = !!usuario?.todasUnidades;
  const [titulo, setTitulo] = useState(conteudo?.titulo ?? "");
  const [rede, setRede] = useState(conteudo?.rede ?? "INSTAGRAM");
  // Situações escolhidas à mão; aprovado, agendado e publicado (Instagram) só pelos botões da lista.
  const [status, setStatus] = useState(conteudo?.status ?? "IDEIA");
  const [data, setData] = useState(conteudo?.dataPrevista ?? "");
  const [responsavelId, setResponsavelId] = useState(conteudo?.responsavelId ?? "");
  const [unidadeId, setUnidadeId] = useState(conteudo ? (conteudo.unidadeId ?? "") : (praca || (todas ? "" : (unidades[0]?.id ?? ""))));
  const [legenda, setLegenda] = useState(conteudo?.legenda ?? "");
  const [link, setLink] = useState(conteudo?.link ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const estadoAutomatico = ["APROVADO", "AGENDADO", "PUBLICADO"].includes(conteudo?.status ?? "") && (rede === "INSTAGRAM" || conteudo?.status === "APROVADO");

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (titulo.trim().length < 2) return setErro("Informe o título.");
    if (link.trim() && !/^https:\/\//i.test(link.trim())) return setErro("O link deve começar com https://");
    setSalvando(true);
    try {
      const corpo = { titulo: titulo.trim(), rede, ...(estadoAutomatico || (conteudo && status === conteudo.status) ? {} : { status }), dataPrevista: data || null, responsavelId: responsavelId || null, unidadeId: unidadeId || null, legenda: legenda.trim() || null, link: link.trim() || null };
      const salvo = conteudo ? await api.patch<Conteudo>(`/api/marketing/conteudos/${conteudo.id}`, corpo) : await api.post<Conteudo>("/api/marketing/conteudos", corpo);
      await aoSalvar(salvo, !conteudo);
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }
  const editaveis = ["IDEIA", "PRODUCAO", "EM_APROVACAO"];
  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {conteudo && ["APROVADO", "AGENDADO"].includes(conteudo.status) && <Aviso tipo="atencao">Este post já está aprovado. Mudar a legenda ou a mídia desfaz a aprovação e tira o post da fila de publicação.</Aviso>}
      <div className="grade-campos">
        <div className="campo campo--largo"><label htmlFor="ct-titulo">Título</label><input id="ct-titulo" value={titulo} maxLength={160} onChange={(e) => setTitulo(e.target.value)} /></div>
        <div className="campo"><label htmlFor="ct-rede">Rede</label><select id="ct-rede" value={rede} onChange={(e) => setRede(e.target.value)}>{Object.entries(ROTULO_REDE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="campo"><label htmlFor="ct-status">Situação</label>
          {estadoAutomatico
            ? <input id="ct-status" value={ROTULO_STATUS_CONTEUDO[conteudo!.status] ?? conteudo!.status} readOnly />
            : <select id="ct-status" value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(ROTULO_STATUS_CONTEUDO).filter(([k]) => rede !== "INSTAGRAM" ? k !== "APROVADO" : editaveis.includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
        </div>
        <div className="campo"><label htmlFor="ct-data">Data prevista</label><input id="ct-data" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
        <div className="campo"><label htmlFor="ct-resp">Responsável</label><select id="ct-resp" value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}><option value="">Sem responsável</option>{responsaveis.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</select></div>
        <div className="campo"><label htmlFor="ct-praca">Praça</label><select id="ct-praca" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>{todas && <option value="">Todas as praças</option>}{unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></div>
        <div className="campo campo--largo"><label htmlFor="ct-link">Link da publicação (opcional)</label><input id="ct-link" type="url" value={link} maxLength={500} onChange={(e) => setLink(e.target.value)} placeholder="https://" /></div>
        <div className="campo campo--largo"><label htmlFor="ct-legenda">Legenda / roteiro</label><textarea id="ct-legenda" rows={5} value={legenda} maxLength={2200} onChange={(e) => setLegenda(e.target.value)} /></div>
        <SugerirLegenda rede={rede} titulo={titulo} aoUsar={setLegenda} />
        {conteudo && rede === "INSTAGRAM" && <MidiasDoPost conteudo={conteudo} aoMudar={aoMudarMidia} />}
        {!conteudo && rede === "INSTAGRAM" && <p className="campo__ajuda campo--largo">Depois de criar, você poderá anexar a mídia, enviar para aprovação e agendar a publicação.</p>}
      </div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>{conteudo ? "Fechar" : "Cancelar"}</button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : conteudo ? "Salvar" : "Criar"}</button>
      </div>
    </form>
  );
}

function FormAgendar({ conteudo, aoFechar, aoAgendar }: { conteudo: Conteudo; aoFechar: () => void; aoAgendar: () => Promise<void> }) {
  const [tipo, setTipo] = useState<TipoPostInstagram>((conteudo.tipoPost as TipoPostInstagram | null) ?? "IMAGEM");
  const [quando, setQuando] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function agendar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!quando) return setErro("Informe a data e a hora da publicação.");
    setSalvando(true);
    try { await api.post(`/api/marketing/conteudos/${conteudo.id}/agendar`, { tipoPost: tipo, agendarEm: paraIso(quando) }); await aoAgendar(); } catch (x) { setErro(mensagemDeErro(x)); } finally { setSalvando(false); }
  }
  return (
    <form onSubmit={agendar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <p>Post: <strong>{conteudo.titulo}</strong> ({conteudo.qtdMidias} mídia{conteudo.qtdMidias === 1 ? "" : "s"})</p>
      <div className="grade-campos">
        <div className="campo"><label htmlFor="ag-tipo">Tipo de post</label><select id="ag-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoPostInstagram)}>{TIPOS_POST_INSTAGRAM.map((t) => <option key={t} value={t}>{ROTULO_TIPO_POST[t]}</option>)}</select></div>
        <div className="campo"><label htmlFor="ag-quando">Data e hora (horário de Brasília)</label><input id="ag-quando" type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} /></div>
      </div>
      <p className="campo__ajuda">O sistema publica sozinho no horário, pelo fluxo oficial do Instagram. Em modo simulado, o post só é marcado como “publicado (simulado)”. Story: suporte a confirmar na documentação da Meta.</p>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoFechar}>Cancelar</button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Agendando…" : "Agendar"}</button>
      </div>
    </form>
  );
}

export function Conteudo() {
  const { pode } = useSessao();
  const notificar = useNotificar();
  const podeGerenciar = pode("marketing:gerenciar");
  const [rede, setRede] = useState("");
  const [status, setStatus] = useState("");
  const lista = useCarregar((s) => api.get<Conteudo[]>(`/api/marketing/conteudos${qs({ rede, status })}`, s), [rede, status]);
  const resp = useCarregar((s) => api.get<Responsavel[]>("/api/marketing/responsaveis", s), []);
  const [form, setForm] = useState<{ conteudo: Conteudo | null } | null>(null);
  const [agendar, setAgendar] = useState<Conteudo | null>(null);
  const [excluir, setExcluir] = useState<Conteudo | null>(null);

  async function acao(c: Conteudo, caminho: string, ok: string) {
    try { await api.post(`/api/marketing/conteudos/${c.id}/${caminho}`); notificar(ok); await lista.recarregar(); } catch (x) { notificar(mensagemDeErro(x), "erro"); }
  }
  async function marcar(c: Conteudo, novo: string) {
    try { await api.patch(`/api/marketing/conteudos/${c.id}`, { status: novo }); await lista.recarregar(); } catch (x) { notificar(mensagemDeErro(x), "erro"); }
  }
  async function confirmarExclusao() {
    if (!excluir) return;
    try {
      await api.delete(`/api/marketing/conteudos/${excluir.id}`);
      notificar("Conteúdo excluído.");
      setExcluir(null);
      await lista.recarregar();
    } catch (x) {
      notificar(mensagemDeErro(x), "erro");
    }
  }

  /** Próximos passos do fluxo: ideia → rascunho → em aprovação → aprovado → agendado → publicado. */
  function Passos({ c }: { c: Conteudo }) {
    if (!podeGerenciar) return null;
    const ig = c.rede === "INSTAGRAM";
    const b = (rotulo: string, fn: () => void) => <button key={rotulo} type="button" className="botao botao--fantasma botao--pequeno" onClick={fn}>{rotulo}</button>;
    if (c.pubStatus === "PUBLICANDO") return null;
    switch (c.status) {
      case "IDEIA": case "PRODUCAO": return b("Enviar para aprovação", () => void acao(c, "solicitar-aprovacao", "Enviado para aprovação."));
      case "EM_APROVACAO": return <>{b("Aprovar", () => void acao(c, "aprovar", "Post aprovado."))}{b("Devolver", () => void acao(c, "devolver", "Devolvido para rascunho."))}</>;
      case "APROVADO": return <>{ig ? b("Agendar", () => setAgendar(c)) : <>{b("Marcar agendado", () => void marcar(c, "AGENDADO"))}{b("Marcar publicado", () => void marcar(c, "PUBLICADO"))}</>}{b("Devolver", () => void acao(c, "devolver", "Devolvido para rascunho."))}</>;
      case "AGENDADO": return ig ? <>{b(c.pubStatus === "FALHOU" ? "Reagendar" : "Alterar horário", () => setAgendar(c))}{b("Cancelar agendamento", () => void acao(c, "cancelar-agendamento", "Agendamento cancelado."))}</> : b("Marcar publicado", () => void marcar(c, "PUBLICADO"));
      default: return null;
    }
  }

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Calendário de conteúdo</h1>
          <p className="pagina__descricao">Posts por rede: ideia, rascunho, aprovação, agendamento e publicação, com responsável e data.</p>
        </div>
        {podeGerenciar && <button type="button" className="botao botao--primario" onClick={() => setForm({ conteudo: null })}><Icone nome="mais" /> Novo conteúdo</button>}
      </div>
      <div className="filtros" role="search" aria-label="Filtrar conteúdo">
        <div className="campo campo--linha"><label htmlFor="cf-rede">Rede</label><select id="cf-rede" value={rede} onChange={(e) => setRede(e.target.value)}><option value="">Todas</option>{Object.entries(ROTULO_REDE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="campo campo--linha"><label htmlFor="cf-status">Situação</label><select id="cf-status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas</option>{Object.entries(ROTULO_STATUS_CONTEUDO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : lista.dados && lista.dados.length === 0 ? (
        <Vazio titulo="Nenhum conteúdo encontrado.">{podeGerenciar ? "Use “Novo conteúdo” para planejar o primeiro post." : undefined}</Vazio>
      ) : lista.dados ? (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th>Data</th><th>Título</th><th>Rede</th><th>Situação</th><th>Responsável</th><th><span className="visualmente-oculto">Ações</span></th></tr></thead>
            <tbody>
              {lista.dados.map((c) => (
                <tr key={c.id}>
                  <td className="sem-quebra">{c.dataPrevista ? formatarData(c.dataPrevista) : <span className="texto-fraco">sem data</span>}</td>
                  <td>{c.link ? <a href={c.link} target="_blank" rel="noopener noreferrer">{c.titulo}</a> : c.titulo}{c.qtdMidias > 0 && <span className="texto-fraco"> · {c.qtdMidias} mídia{c.qtdMidias === 1 ? "" : "s"}</span>}</td>
                  <td>{ROTULO_REDE[c.rede] ?? c.rede}</td>
                  <td><span className={`etiqueta ${CLASSE_STATUS[c.status] ?? ""}`}>{ROTULO_STATUS_CONTEUDO[c.status] ?? c.status}</span><SituacaoPublicacao c={c} /></td>
                  <td>{c.responsavel ?? <span className="texto-fraco">—</span>}</td>
                  <td className="sem-quebra">
                    <Passos c={c} />
                    {podeGerenciar && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setForm({ conteudo: c })}>Editar</button>}
                    {podeGerenciar && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setExcluir(c)}>Excluir</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Modal aberto={!!form} titulo={form?.conteudo ? "Editar conteúdo" : "Novo conteúdo"} aoFechar={() => setForm(null)} largura="larga">
        {form && <FormConteudo key={form.conteudo?.id ?? "novo"} conteudo={form.conteudo} responsaveis={resp.dados ?? []} aoCancelar={() => setForm(null)} aoMudarMidia={async () => { await lista.recarregar(); }}
          aoSalvar={async (salvo, criado) => {
            await lista.recarregar();
            if (criado && salvo.rede === "INSTAGRAM") { setForm({ conteudo: { ...salvo, qtdMidias: 0 } }); notificar("Conteúdo criado. Agora anexe a mídia."); } else { setForm(null); notificar("Conteúdo salvo."); }
          }} />}
      </Modal>
      <Modal aberto={!!agendar} titulo="Agendar no Instagram" aoFechar={() => setAgendar(null)}>
        {agendar && <FormAgendar conteudo={agendar} aoFechar={() => setAgendar(null)} aoAgendar={async () => { setAgendar(null); notificar("Post agendado."); await lista.recarregar(); }} />}
      </Modal>
      <Confirmar aberto={!!excluir} titulo="Excluir conteúdo" perigo textoConfirmar="Excluir" aoFechar={() => setExcluir(null)} aoConfirmar={() => void confirmarExclusao()} mensagem={<>Excluir <strong>{excluir?.titulo}</strong> do calendário?</>} />
    </div>
  );
}
