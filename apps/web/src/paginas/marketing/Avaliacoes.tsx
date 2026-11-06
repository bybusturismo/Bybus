import { useState, type FormEvent } from "react";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Indicador, Indicadores } from "../../componentes/Indicador";
import { Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { CabecalhoPagina } from "../../componentes/Pagina";
import { useSessao } from "../../sessao/Sessao";
import { formatarData, formatarNumero, hojeIso } from "../../util/formato";
import { ROTULO_CANAL } from "../../util/rotulos";
import { useCarregar } from "../../util/useCarregar";
import { BarrasLista, Evolucao, FiltroPeriodo, ROTULO_CANAL_AVALIACAO, ROTULO_IDIOMA, ROTULO_STATUS_PEDIDO, usePeriodo } from "./comum";

interface Resumo {
  notas: { quantidade: number; media: number | null; distribuicao: Array<{ nota: number; quantidade: number }>; porGuia: Array<{ chave: string; quantidade: number; media: number | null }>; porCanal: Array<{ chave: string; quantidade: number; media: number | null }> };
  pedidos: Record<string, number>;
  funil: { elegiveis: number; pedidos: number; feitos: number; avaliados: number; lembretesSugeridos: number; taxaPedidos: number | null; taxaAvaliacao: number | null };
  semanal: Array<{ semana: string; pedidos: number; feitos: number; avaliados: number }>;
  tripadvisor: { reservasViator: number; passageirosViator: number; link: string | null };
}
interface Pedido {
  id: string; reservaId: string; status: string; texto: string; idioma: string; canalAvaliacao: string; link: string | null; data: string; passeio: string; canal: string;
  temTelefone: boolean; lembreteSugerido: boolean; nps: string | null; pedidoEm: string | null;
}
interface Externa { id: string; semana: string; canal: string; alvo: string; unidadeId: string | null; notaCentesimos: number; quantidade: number }
interface Config {
  modelos: Record<"pt" | "en" | "es", string>; padroes: Record<"pt" | "en" | "es", string>; linkTripadvisor: string | null;
  linksGoogle: Array<{ unidadeId: string; codigo: string; nome: string; link: string | null }>; envio: { real: boolean; nota: string };
}

const estrelas = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);
const rotuloCanal = (c: string) => (ROTULO_CANAL as Record<string, string>)[c] ?? c;
const CANAIS_EXTERNOS: Record<string, string> = { GOOGLE: "Google", TRIPADVISOR: "Tripadvisor", VIATOR: "Viator", CIVITATIS: "Civitatis", DECOLAR: "Decolar", OUTRO: "Outro" };
const nota2 = (c: number) => (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

function NotaForm({ pedido, aoSalvar, aoCancelar }: { pedido: Pedido; aoSalvar: () => Promise<void>; aoCancelar: () => void }) {
  const [nota, setNota] = useState(5);
  const [comentario, setComentario] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      await api.post("/api/marketing/avaliacoes/notas", { reservaId: pedido.reservaId, nota, comentario: comentario.trim() || null });
      await aoSalvar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <p className="texto-fraco">{pedido.passeio} em {formatarData(pedido.data)} ({rotuloCanal(pedido.canal)})</p>
      <div className="campo"><label htmlFor="nt-nota">Nota</label>
        <select id="nt-nota" value={nota} onChange={(e) => setNota(Number(e.target.value))}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} — {estrelas(n)}</option>)}</select>
      </div>
      <div className="campo"><label htmlFor="nt-com">Comentário (opcional, sem dados pessoais)</label><textarea id="nt-com" rows={3} maxLength={500} value={comentario} onChange={(e) => setComentario(e.target.value)} /></div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : "Registrar nota"}</button>
      </div>
    </form>
  );
}

function EditarTexto({ pedido, aoSalvar, aoCancelar }: { pedido: Pedido; aoSalvar: () => Promise<void>; aoCancelar: () => void }) {
  const [texto, setTexto] = useState(pedido.texto);
  const [erro, setErro] = useState<string | null>(null);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    try { await api.patch(`/api/marketing/avaliacoes/pedidos/${pedido.id}`, { texto: texto.trim() }); await aoSalvar(); } catch (x) { setErro(mensagemDeErro(x)); }
  }
  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="campo"><label htmlFor="ed-texto">Mensagem ({ROTULO_IDIOMA[pedido.idioma]})</label><textarea id="ed-texto" rows={6} maxLength={1000} value={texto} onChange={(e) => setTexto(e.target.value)} /></div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario">Salvar mensagem</button>
      </div>
    </form>
  );
}

function ConfigForm({ config, aoSalvar }: { config: Config; aoSalvar: () => Promise<void> }) {
  const notificar = useNotificar();
  const [modelos, setModelos] = useState(config.modelos);
  const [trip, setTrip] = useState(config.linkTripadvisor ?? "");
  const [google, setGoogle] = useState<Record<string, string>>(Object.fromEntries(config.linksGoogle.map((l) => [l.unidadeId, l.link ?? ""])));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    for (const l of [trip, ...Object.values(google)]) if (l.trim() && !/^https:\/\//i.test(l.trim())) return setErro("Os links precisam começar com https://");
    setSalvando(true);
    try {
      await api.patch("/api/marketing/avaliacoes/config", { modelos, linkTripadvisor: trip.trim() || null, linksGoogle: config.linksGoogle.map((l) => ({ unidadeId: l.unidadeId, link: google[l.unidadeId]?.trim() || null })) });
      notificar("Configuração salva.");
      await aoSalvar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grade-campos">
        {config.linksGoogle.map((l) => (
          <div className="campo" key={l.unidadeId}><label htmlFor={`g-${l.codigo}`}>Link de avaliação no Google — {l.nome}</label>
            <input id={`g-${l.codigo}`} type="url" placeholder="https://g.page/r/…" maxLength={500} value={google[l.unidadeId] ?? ""} onChange={(e) => setGoogle({ ...google, [l.unidadeId]: e.target.value })} /></div>
        ))}
        <div className="campo"><label htmlFor="g-trip">Link da página no Tripadvisor (a confirmar com o dono)</label><input id="g-trip" type="url" placeholder="https://" maxLength={500} value={trip} onChange={(e) => setTrip(e.target.value)} /></div>
      </div>
      {(["pt", "en", "es"] as const).map((i) => (
        <div className="campo" key={i}>
          <label htmlFor={`m-${i}`}>Mensagem — {ROTULO_IDIOMA[i]}</label>
          <textarea id={`m-${i}`} rows={3} maxLength={1000} value={modelos[i]} onChange={(e) => setModelos({ ...modelos, [i]: e.target.value })} />
          <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setModelos({ ...modelos, [i]: config.padroes[i] })}>Voltar ao texto padrão</button>
        </div>
      ))}
      <p className="campo__ajuda">Variáveis: {"{nome}"} (só o primeiro nome), {"{passeio}"}, {"{data}"} e {"{link}"}. Quem comprou pela Viator recebe sempre a orientação de avaliar na própria Viator.</p>
      <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : "Salvar configuração"}</button>
    </form>
  );
}

function NotasCanais({ podeGerenciar, unidadeIds, aoMudar }: { podeGerenciar: boolean; unidadeIds: Array<{ id: string; nome: string }>; aoMudar: () => void }) {
  const notificar = useNotificar();
  const { usuario } = useSessao();
  const lista = useCarregar((s) => api.get<Externa[]>("/api/marketing/avaliacoes/externas", s), []);
  const [canal, setCanal] = useState("GOOGLE");
  const [concorrente, setConcorrente] = useState("");
  const [unidadeId, setUnidadeId] = useState(usuario?.todasUnidades ? "" : (unidadeIds[0]?.id ?? ""));
  const [nota, setNota] = useState("");
  const [qtd, setQtd] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const dados = lista.dados ?? [];
  const series = new Map<string, Externa[]>();
  for (const e of dados) series.set(`${e.canal}|${e.alvo}`, [...(series.get(`${e.canal}|${e.alvo}`) ?? []), e]);

  async function lancar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const n = Number(nota.replace(",", "."));
    const q = Number(qtd);
    if (!(n >= 1 && n <= 5)) return setErro("Nota de 1 a 5 (ex.: 4,78).");
    if (!Number.isInteger(q) || q < 0) return setErro("Quantidade de avaliações: número inteiro.");
    try {
      await api.post("/api/marketing/avaliacoes/externas", { data: hojeIso(), canal, concorrente: concorrente.trim() || null, unidadeId: unidadeId || null, nota: n, quantidade: q });
      notificar("Lançamento salvo.");
      setNota(""); setQtd("");
      await lista.recarregar();
      aoMudar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  async function remover(id: string) {
    try { await api.delete(`/api/marketing/avaliacoes/externas/${id}`); await lista.recarregar(); } catch (x) { notificar(mensagemDeErro(x), "erro"); }
  }

  return (
    <section className="cartao" aria-labelledby="t-ext">
      <h2 id="t-ext">Notas nos canais (lançamento semanal)</h2>
      <p className="texto-fraco">Anote uma vez por semana a nota e o total de avaliações de cada canal, da By Bus e de 2 ou 3 concorrentes (opcional). A evolução aparece abaixo.</p>
      {podeGerenciar && (
        <form onSubmit={lancar} noValidate>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div className="grade-campos">
            <div className="campo"><label htmlFor="ex-canal">Canal</label><select id="ex-canal" value={canal} onChange={(e) => setCanal(e.target.value)}>{Object.entries(CANAIS_EXTERNOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="campo"><label htmlFor="ex-conc">Concorrente (vazio = By Bus)</label><input id="ex-conc" value={concorrente} maxLength={80} onChange={(e) => setConcorrente(e.target.value)} /></div>
            <div className="campo"><label htmlFor="ex-praca">Praça</label><select id="ex-praca" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>{usuario?.todasUnidades && <option value="">Todas as praças</option>}{unidadeIds.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></div>
            <div className="campo"><label htmlFor="ex-nota">Nota</label><input id="ex-nota" inputMode="decimal" placeholder="4,78" value={nota} onChange={(e) => setNota(e.target.value)} /></div>
            <div className="campo"><label htmlFor="ex-qtd">Total de avaliações</label><input id="ex-qtd" inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value)} /></div>
          </div>
          <button type="submit" className="botao botao--primario">Lançar nesta semana</button>
        </form>
      )}
      {lista.carregando && !lista.dados ? <Carregando /> : series.size === 0 ? <Vazio titulo="Nenhum lançamento ainda." /> : (
        <div className="m2-grade">
          {[...series.entries()].map(([k, linhas]) => {
            const [c, alvo] = k.split("|") as [string, string];
            const ultima = linhas[linhas.length - 1]!, primeira = linhas[0]!;
            const dif = ultima.notaCentesimos - primeira.notaCentesimos;
            return (
              <div key={k}>
                <h3>{CANAIS_EXTERNOS[c] ?? c} — {alvo === "PROPRIA" ? "By Bus" : alvo}</h3>
                <p><span className="m2-nps-nota">{nota2(ultima.notaCentesimos)}</span> <span className="texto-fraco">({formatarNumero(ultima.quantidade)} avaliações em {formatarData(ultima.semana)}{linhas.length > 1 ? `; ${dif >= 0 ? "+" : ""}${nota2(dif)} desde ${formatarData(primeira.semana)}` : ""})</span></p>
                <Evolucao pontos={linhas.map((l) => l.notaCentesimos)} rotulo={`Evolução da nota no ${CANAIS_EXTERNOS[c] ?? c}`} />
                {podeGerenciar && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void remover(ultima.id)}>Remover o último lançamento</button>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function Avaliacoes() {
  const { praca, pode, unidades } = useSessao();
  const notificar = useNotificar();
  const podeGerenciar = pode("marketing:gerenciar");
  const [periodo, setPeriodo] = usePeriodo(30, 0);
  const [filtro, setFiltro] = useState("");
  const consulta = qs({ de: periodo.de, ate: periodo.ate, unidadeId: praca });
  const resumo = useCarregar((s) => api.get<Resumo>(`/api/marketing/avaliacoes/resumo${consulta}`, s), [consulta]);
  const pedidos = useCarregar((s) => api.get<Pedido[]>(`/api/marketing/avaliacoes/pedidos${consulta}`, s), [consulta]);
  const config = useCarregar((s) => api.get<Config>("/api/marketing/avaliacoes/config", s), []);
  const [notaDe, setNotaDe] = useState<Pedido | null>(null);
  const [editar, setEditar] = useState<Pedido | null>(null);
  const [gerando, setGerando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function recarregarTudo() { await Promise.all([resumo.recarregar(), pedidos.recarregar()]); }
  async function gerar() {
    setGerando(true);
    try {
      const r = await api.post<{ criados: number }>("/api/marketing/avaliacoes/pedidos/gerar", { de: periodo.de, ate: periodo.ate, unidadeId: praca || undefined });
      notificar(r.criados ? `${r.criados} pedido(s) na fila. Nada foi enviado.` : "Nenhum pedido novo no período.");
      await recarregarTudo();
    } catch (x) { notificar(mensagemDeErro(x), "erro"); } finally { setGerando(false); }
  }
  async function enviarTodos() {
    setEnviando(true);
    try {
      const r = await api.post<{ enviados: number; falhas: number; simulado: boolean }>("/api/marketing/avaliacoes/pedidos/enviar-pendentes", { de: periodo.de, ate: periodo.ate, unidadeId: praca || undefined });
      notificar(r.simulado ? `${r.enviados} pedido(s) simulado(s): nada saiu de verdade.` : `${r.enviados} pedido(s) enviado(s).`);
      await recarregarTudo();
    } catch (x) { notificar(mensagemDeErro(x), "erro"); } finally { setEnviando(false); }
  }
  async function enviar(p: Pedido, lembrete: boolean) {
    try {
      const r = await api.post<{ simulado: boolean }>(`/api/marketing/avaliacoes/pedidos/${p.id}/enviar`, { lembrete });
      notificar(r.simulado ? "Simulado: nada saiu de verdade." : "Mensagem enviada.");
      await recarregarTudo();
    } catch (x) { notificar(mensagemDeErro(x), "erro"); }
  }
  async function alterar(p: Pedido, corpo: Record<string, unknown>) {
    try { await api.patch(`/api/marketing/avaliacoes/pedidos/${p.id}`, corpo); await recarregarTudo(); } catch (x) { notificar(mensagemDeErro(x), "erro"); }
  }
  async function copiar(p: Pedido) {
    try { await navigator.clipboard.writeText(p.texto); notificar("Mensagem copiada."); } catch { notificar("Não foi possível copiar. Selecione o texto e copie à mão.", "erro"); }
  }

  const r = resumo.dados;
  const lista = (pedidos.dados ?? []).filter((p) => !filtro || p.status === filtro);
  const f = r?.funil;
  return (
    <div className="pagina">
      <CabecalhoPagina titulo="Avaliações"
        descricao="Fila diária de quem passeou, com mensagem pronta no idioma do cliente, link do canal certo e acompanhamento: pedido, lembrete e avaliação."
        filtros={<FiltroPeriodo periodo={periodo} aoMudar={setPeriodo} />}
        acoes={podeGerenciar && (
          <>
            <button type="button" className="botao botao--secundario" disabled={enviando} onClick={() => void enviarTodos()}>{enviando ? "Enviando…" : "Enviar a fila"}</button>
            <button type="button" className="botao botao--primario" disabled={gerando} onClick={() => void gerar()}>{gerando ? "Gerando…" : "Gerar fila do período"}</button>
          </>
        )} />
      {config.dados && !config.dados.envio.real && <Aviso tipo="info">{config.dados.envio.nota}</Aviso>}
      {resumo.carregando && !r ? <Carregando /> : resumo.erro ? <ErroCarga mensagem={resumo.erro} tentarDeNovo={resumo.recarregar} /> : r && f ? (
        <>
          <Indicadores rotulo="Resumo das avaliações">
            <Indicador tinta="azul" icone="mensagem" rotulo="Taxa de pedidos" valor={f.taxaPedidos == null ? "—" : `${f.taxaPedidos.toLocaleString("pt-BR")}%`} detalhe={`${formatarNumero(f.feitos)} de ${formatarNumero(f.elegiveis)} reservas realizadas`} />
            <Indicador tinta="verde" icone="check" rotulo="Avaliadas" valor={formatarNumero(f.avaliados)} detalhe={f.taxaAvaliacao == null ? undefined : `${f.taxaAvaliacao.toLocaleString("pt-BR")}% dos pedidos`} />
            <Indicador tinta="laranja" icone="alerta" rotulo="Lembretes sugeridos" valor={formatarNumero(f.lembretesSugeridos)} detalhe="pedido feito há 7 dias ou mais" />
            <Indicador tinta="ambar" icone="estrela" rotulo="Nota média interna" valor={r.notas.media == null ? "—" : r.notas.media.toLocaleString("pt-BR")} detalhe={`${formatarNumero(r.notas.quantidade)} nota(s)`} />
          </Indicadores>
          {r.semanal.length > 0 && (
            <section className="cartao" aria-labelledby="t-sem">
              <h2 id="t-sem">Evolução semanal</h2>
              <div className="tabela-rolagem"><table className="tabela">
                <thead><tr><th>Semana</th><th className="num">Na fila</th><th className="num">Pedidos feitos</th><th className="num">Avaliadas</th></tr></thead>
                <tbody>{r.semanal.map((s) => <tr key={s.semana}><td>{formatarData(s.semana)}</td><td className="num">{s.pedidos}</td><td className="num">{s.feitos}</td><td className="num">{s.avaliados}</td></tr>)}</tbody>
              </table></div>
            </section>
          )}
        </>
      ) : null}

      <section className="cartao" aria-labelledby="t-pedidos">
        <div className="m2-linha-acoes">
          <h2 id="t-pedidos">Fila de pedidos</h2>
          <div className="campo campo--linha"><label htmlFor="f-status">Situação</label>
            <select id="f-status" value={filtro} onChange={(e) => setFiltro(e.target.value)}><option value="">Todas</option>{Object.entries(ROTULO_STATUS_PEDIDO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </div>
        {pedidos.carregando && !pedidos.dados ? <Carregando /> : pedidos.erro ? <ErroCarga mensagem={pedidos.erro} tentarDeNovo={pedidos.recarregar} /> : lista.length === 0 ? (
          <Vazio titulo="Nenhum pedido no período.">{podeGerenciar ? "Use “Gerar fila do período” para listar as reservas já realizadas." : undefined}</Vazio>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th>Passeio</th><th>Idioma e canal</th><th>Situação</th><th>Mensagem</th><th><span className="visualmente-oculto">Ações</span></th></tr></thead>
              <tbody>
                {lista.map((p) => {
                  const feito = ["ENVIADA_MANUAL", "SIMULADA", "ENVIADA", "LEMBRADA"].includes(p.status);
                  return (
                    <tr key={p.id}>
                      <td className="sem-quebra">{formatarData(p.data)}<div className="texto-fraco">{p.passeio}</div><div className="texto-fraco">{rotuloCanal(p.canal)}</div></td>
                      <td>
                        {podeGerenciar && p.status !== "AVALIADA" ? (
                          <>
                            <select aria-label="Idioma da mensagem" value={p.idioma} onChange={(e) => void alterar(p, { idioma: e.target.value })}>{Object.entries(ROTULO_IDIOMA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                            {p.canalAvaliacao === "VIATOR" ? <div className="texto-fraco">{ROTULO_CANAL_AVALIACAO.VIATOR}</div> : (
                              <select aria-label="Canal da avaliação" value={p.canalAvaliacao === "NENHUM" ? "GOOGLE" : p.canalAvaliacao} onChange={(e) => void alterar(p, { canalAvaliacao: e.target.value })}><option value="GOOGLE">Google</option><option value="TRIPADVISOR">Tripadvisor</option></select>
                            )}
                          </>
                        ) : <>{ROTULO_IDIOMA[p.idioma]}<div className="texto-fraco">{ROTULO_CANAL_AVALIACAO[p.canalAvaliacao]}</div></>}
                        {p.canalAvaliacao === "NENHUM" && <div className="texto-fraco">Cadastre o link em “Configuração”.</div>}
                      </td>
                      <td>
                        <span className={`etiqueta ${p.status === "PENDENTE" ? "etiqueta--atencao" : p.status === "AVALIADA" ? "etiqueta--sucesso" : "etiqueta--neutra"}`}>{ROTULO_STATUS_PEDIDO[p.status] ?? p.status}</span>
                        {p.lembreteSugerido && <span className="etiqueta etiqueta--atencao" title="Pedido feito há 7 dias ou mais">lembrete sugerido</span>}
                        {p.nps && <div className="texto-fraco">NPS {p.nps === "RESPONDIDO" ? "respondido" : "enviado"}</div>}
                      </td>
                      <td><pre className="texto-copiavel">{p.texto}</pre></td>
                      <td className="sem-quebra">
                        <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void copiar(p)}>Copiar</button>
                        {podeGerenciar && p.status === "PENDENTE" && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setEditar(p)}>Editar</button>}
                        {podeGerenciar && p.status === "PENDENTE" && p.temTelefone && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void enviar(p, false)}>Enviar</button>}
                        {podeGerenciar && p.status === "PENDENTE" && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void alterar(p, { status: "ENVIADA_MANUAL" })}>Pedi à mão</button>}
                        {podeGerenciar && feito && p.status !== "LEMBRADA" && p.temTelefone && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void enviar(p, true)}>Lembrar</button>}
                        {podeGerenciar && feito && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void alterar(p, { status: "AVALIADA" })}>Avaliou</button>}
                        {podeGerenciar && ["PENDENTE", "SEM_TELEFONE"].includes(p.status) && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void alterar(p, { status: "IGNORADA" })}>Ignorar</button>}
                        {podeGerenciar && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setNotaDe(p)}>Registrar nota</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="texto-fraco">Regra das plataformas: o convite vai para todos os clientes, nunca só para quem deu nota alta, e sem oferecer vantagem em troca da avaliação. Quem comprou pela Viator avalia na própria Viator (“Request Reviews”).</p>
      </section>

      <NotasCanais podeGerenciar={podeGerenciar} unidadeIds={unidades.map((u) => ({ id: u.id, nome: u.nome }))} aoMudar={() => void resumo.recarregar()} />

      {r && r.notas.quantidade > 0 && (
        <section className="cartao" aria-labelledby="t-notas">
          <h2 id="t-notas">Notas internas</h2>
          <BarrasLista itens={r.notas.distribuicao.slice().reverse().map((d) => ({ rotulo: `${d.nota} ${estrelas(d.nota)}`, valor: d.quantidade }))} />
          {r.notas.porGuia.length > 0 && <p className="texto-fraco">Por guia: {r.notas.porGuia.map((g) => `${g.chave} ${g.media?.toLocaleString("pt-BR")} (${g.quantidade})`).join(" · ")}</p>}
          {r.notas.porCanal.length > 0 && <p className="texto-fraco">Por canal: {r.notas.porCanal.map((g) => `${rotuloCanal(g.chave)} ${g.media?.toLocaleString("pt-BR")} (${g.quantidade})`).join(" · ")}</p>}
        </section>
      )}

      {podeGerenciar && config.dados && (
        <section className="cartao" aria-labelledby="t-modelo">
          <h2 id="t-modelo">Configuração: links e mensagens por idioma</h2>
          <ConfigForm key={JSON.stringify(config.dados.modelos) + JSON.stringify(config.dados.linksGoogle) + (config.dados.linkTripadvisor ?? "")} config={config.dados} aoSalvar={config.recarregar} />
        </section>
      )}

      <Modal aberto={!!notaDe} titulo="Registrar nota interna" aoFechar={() => setNotaDe(null)}>
        {notaDe && <NotaForm pedido={notaDe} aoCancelar={() => setNotaDe(null)} aoSalvar={async () => { setNotaDe(null); notificar("Nota registrada."); await recarregarTudo(); }} />}
      </Modal>
      <Modal aberto={!!editar} titulo="Editar mensagem" aoFechar={() => setEditar(null)}>
        {editar && <EditarTexto pedido={editar} aoCancelar={() => setEditar(null)} aoSalvar={async () => { setEditar(null); notificar("Mensagem salva."); await recarregarTudo(); }} />}
      </Modal>
    </div>
  );
}
