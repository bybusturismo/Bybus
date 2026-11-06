import { useState, type FormEvent } from "react";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Indicador, Indicadores } from "../../componentes/Indicador";
import { Confirmar, Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { CabecalhoPagina } from "../../componentes/Pagina";
import { VerPublica } from "../../componentes/VerPublica";
import { useSessao } from "../../sessao/Sessao";
import { formatarData, formatarNumero } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { BarrasLista, FiltroPeriodo, usePeriodo } from "./comum";
import { BioPublica } from "../publico/BioPublica";

interface Botao { id: string; rotulo: string; url: string; tipo: string; ordem: number; destaque: boolean; ativo: boolean }
interface Bio { config: { titulo: string; subtitulo: string; corPrimaria: string; corFundo: string; cupomCodigo: string | null; cupomTexto: string | null }; botoes: Botao[]; caminhoPublico: string }
interface Cliques { visitas: number; cliques: number; taxaCliquePorVisita: number | null; porBotao: Array<{ id: string; rotulo: string; cliques: number }>; porDia: Array<{ dia: string; visitas: number; cliques: number }>; porOrigem: Array<{ origem: string; visitas: number; cliques: number }> }
const TIPOS: Record<string, string> = { PAYTOUR: "Reservar na Paytour", WHATSAPP: "WhatsApp", TRIPADVISOR: "Tripadvisor", PASSEIOS: "Passeios", SITE: "Site", OUTRO: "Outro" };

function FormBotao({ botao, aoSalvar, aoCancelar }: { botao: Botao | null; aoSalvar: () => Promise<void>; aoCancelar: () => void }) {
  const [rotulo, setRotulo] = useState(botao?.rotulo ?? "");
  const [url, setUrl] = useState(botao?.url ?? "");
  const [tipo, setTipo] = useState(botao?.tipo ?? "PAYTOUR");
  const [ordem, setOrdem] = useState(String(botao?.ordem ?? 0));
  const [destaque, setDestaque] = useState(botao?.destaque ?? false);
  const [ativo, setAtivo] = useState(botao?.ativo ?? true);
  const [erro, setErro] = useState<string | null>(null);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (rotulo.trim().length < 2) return setErro("Informe o texto do botão.");
    if (!/^https:\/\//i.test(url.trim())) return setErro("O endereço deve começar com https://");
    const corpo = { rotulo: rotulo.trim(), url: url.trim(), tipo, ordem: Number(ordem) || 0, destaque, ativo };
    try { if (botao) await api.patch(`/api/marketing/bio/botoes/${botao.id}`, corpo); else await api.post("/api/marketing/bio/botoes", corpo); await aoSalvar(); } catch (x) { setErro(mensagemDeErro(x)); }
  }
  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grade-campos">
        <div className="campo"><label htmlFor="bb-rot">Texto do botão</label><input id="bb-rot" value={rotulo} maxLength={60} onChange={(e) => setRotulo(e.target.value)} /></div>
        <div className="campo"><label htmlFor="bb-tipo">Tipo</label><select id="bb-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="campo campo--largo"><label htmlFor="bb-url">Endereço (https://)</label><input id="bb-url" type="url" value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} /></div>
        <div className="campo"><label htmlFor="bb-ord">Ordem (0 = primeiro)</label><input id="bb-ord" inputMode="numeric" value={ordem} onChange={(e) => setOrdem(e.target.value)} /></div>
      </div>
      <label className="interruptor"><input type="checkbox" checked={destaque} onChange={(e) => setDestaque(e.target.checked)} /> Botão em destaque (cor cheia)</label>
      <label className="interruptor"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Aparece na página</label>
      <div className="modal__acoes"><button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button><button type="submit" className="botao botao--primario">{botao ? "Salvar botão" : "Adicionar botão"}</button></div>
    </form>
  );
}

function FormConfig({ bio, aoSalvar }: { bio: Bio["config"]; aoSalvar: () => Promise<void> }) {
  const notificar = useNotificar();
  const [v, setV] = useState({ titulo: bio.titulo, subtitulo: bio.subtitulo, corPrimaria: bio.corPrimaria, corFundo: bio.corFundo, cupomCodigo: bio.cupomCodigo ?? "", cupomTexto: bio.cupomTexto ?? "" });
  const [erro, setErro] = useState<string | null>(null);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try { await api.patch("/api/marketing/bio/config", { ...v, cupomCodigo: v.cupomCodigo.trim() || null, cupomTexto: v.cupomTexto.trim() || null }); notificar("Página salva."); await aoSalvar(); } catch (x) { setErro(mensagemDeErro(x)); }
  }
  const s = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grade-campos">
        <div className="campo"><label htmlFor="bc-t">Título</label><input id="bc-t" value={v.titulo} maxLength={80} onChange={s("titulo")} /></div>
        <div className="campo"><label htmlFor="bc-s">Subtítulo</label><input id="bc-s" value={v.subtitulo} maxLength={160} onChange={s("subtitulo")} /></div>
        <div className="campo"><label htmlFor="bc-c1">Cor dos botões</label><input id="bc-c1" type="color" value={v.corPrimaria} onChange={s("corPrimaria")} /></div>
        <div className="campo"><label htmlFor="bc-c2">Cor do fundo</label><input id="bc-c2" type="color" value={v.corFundo} onChange={s("corFundo")} /></div>
        <div className="campo"><label htmlFor="bc-cu">Cupom em destaque (código)</label><input id="bc-cu" value={v.cupomCodigo} maxLength={30} onChange={s("cupomCodigo")} /></div>
        <div className="campo"><label htmlFor="bc-ct">Texto do cupom</label><input id="bc-ct" value={v.cupomTexto} maxLength={160} onChange={s("cupomTexto")} /></div>
      </div>
      <button type="submit" className="botao botao--primario">Salvar página</button>
    </form>
  );
}

export function LinkBio() {
  const { pode, usuario } = useSessao();
  const notificar = useNotificar();
  const edita = pode("marketing:gerenciar") && !!usuario?.todasUnidades;
  const [periodo, setPeriodo] = usePeriodo(30, 0);
  const bio = useCarregar((s) => api.get<Bio>("/api/marketing/bio", s), []);
  const num = useCarregar((s) => api.get<Cliques>(`/api/marketing/bio/cliques${qs({ de: periodo.de, ate: periodo.ate })}`, s), [periodo.de, periodo.ate]);
  const [form, setForm] = useState<{ botao: Botao | null } | null>(null);
  const [excluir, setExcluir] = useState<Botao | null>(null);
  const b = bio.dados, n = num.dados;

  async function remover() {
    if (!excluir) return;
    try { await api.delete(`/api/marketing/bio/botoes/${excluir.id}`); notificar("Botão excluído."); setExcluir(null); await Promise.all([bio.recarregar(), num.recarregar()]); } catch (x) { notificar(mensagemDeErro(x), "erro"); }
  }
  return (
    <div className="pagina">
      <CabecalhoPagina titulo="Link na bio" descricao="Página pública para o perfil do Instagram, com botões e cliques medidos por botão, dia e origem (sem guardar IP nem dado pessoal)."
        filtros={<FiltroPeriodo periodo={periodo} aoMudar={setPeriodo} />}
        acoes={<><VerPublica titulo="Página pública /bio" caminho="/bio"><BioPublica incorporado /></VerPublica>{edita && <button type="button" className="botao botao--primario" onClick={() => setForm({ botao: null })}>Novo botão</button>}</>} />
      {!edita && <Aviso tipo="info">Só quem enxerga todas as praças e gerencia o marketing edita esta página.</Aviso>}
      {num.carregando && !n ? <Carregando /> : num.erro ? <ErroCarga mensagem={num.erro} tentarDeNovo={num.recarregar} /> : n ? (
        <>
          <Indicadores rotulo="Números do link na bio">
            <Indicador tinta="azul" icone="pessoas" rotulo="Visitas" valor={formatarNumero(n.visitas)} />
            <Indicador tinta="verde" icone="seta" rotulo="Cliques nos botões" valor={formatarNumero(n.cliques)} detalhe={n.taxaCliquePorVisita == null ? undefined : `${n.taxaCliquePorVisita.toLocaleString("pt-BR")}% das visitas`} />
          </Indicadores>
          <div className="m2-grade">
            <section className="cartao" aria-labelledby="bi-b"><h2 id="bi-b">Cliques por botão</h2>{n.porBotao.length ? <BarrasLista itens={n.porBotao.map((x) => ({ rotulo: x.rotulo, valor: x.cliques }))} /> : <p className="texto-fraco">Sem botões.</p>}</section>
            <section className="cartao" aria-labelledby="bi-o"><h2 id="bi-o">Origem (utm_source)</h2>{n.porOrigem.length ? <table className="tabela"><thead><tr><th>Origem</th><th className="num">Visitas</th><th className="num">Cliques</th></tr></thead><tbody>{n.porOrigem.map((o) => <tr key={o.origem}><td>{o.origem}</td><td className="num">{o.visitas}</td><td className="num">{o.cliques}</td></tr>)}</tbody></table> : <p className="texto-fraco">Sem dados no período.</p>}
              <p className="texto-fraco">Use <code>?utm_source=instagram</code> no endereço da bio para ver a origem.</p></section>
          </div>
          {n.porDia.length > 0 && <section className="cartao" aria-labelledby="bi-d"><h2 id="bi-d">Por dia</h2><div className="tabela-rolagem"><table className="tabela"><thead><tr><th>Dia</th><th className="num">Visitas</th><th className="num">Cliques</th></tr></thead><tbody>{n.porDia.map((x) => <tr key={x.dia}><td>{formatarData(x.dia)}</td><td className="num">{x.visitas}</td><td className="num">{x.cliques}</td></tr>)}</tbody></table></div></section>}
        </>
      ) : null}
      <section className="cartao" aria-labelledby="bi-bt">
        <h2 id="bi-bt">Botões</h2>
        {bio.carregando && !b ? <Carregando /> : bio.erro ? <ErroCarga mensagem={bio.erro} tentarDeNovo={bio.recarregar} /> : b && b.botoes.length === 0 ? <Vazio titulo="Nenhum botão cadastrado." /> : b ? (
          <div className="tabela-rolagem"><table className="tabela"><thead><tr><th>Botão</th><th>Tipo</th><th>Situação</th><th><span className="visualmente-oculto">Ações</span></th></tr></thead>
            <tbody>{b.botoes.map((x) => <tr key={x.id} className={x.ativo ? "" : "linha--inativa"}><td><strong>{x.rotulo}</strong><div className="texto-fraco" style={{ overflowWrap: "anywhere" }}>{x.url}</div></td><td>{TIPOS[x.tipo]}</td><td>{x.ativo ? "Aparece" : "Escondido"}{x.destaque ? " · destaque" : ""}</td>
              <td className="sem-quebra">{edita && <><button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setForm({ botao: x })}>Editar</button><button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setExcluir(x)}>Excluir</button></>}</td></tr>)}</tbody></table></div>
        ) : null}
      </section>
      {edita && b && <section className="cartao" aria-labelledby="bi-cf"><h2 id="bi-cf">Aparência e cupom</h2><FormConfig key={JSON.stringify(b.config)} bio={b.config} aoSalvar={bio.recarregar} /></section>}
      <Modal aberto={!!form} titulo={form?.botao ? "Editar botão" : "Novo botão"} aoFechar={() => setForm(null)}>
        {form && <FormBotao botao={form.botao} aoCancelar={() => setForm(null)} aoSalvar={async () => { setForm(null); notificar("Botão salvo."); await bio.recarregar(); }} />}
      </Modal>
      <Confirmar aberto={!!excluir} titulo="Excluir botão" perigo textoConfirmar="Excluir botão" aoFechar={() => setExcluir(null)} aoConfirmar={() => void remover()} mensagem={<>O botão <strong>{excluir?.rotulo}</strong> e os cliques dele serão apagados.</>} />
    </div>
  );
}
