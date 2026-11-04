import { useState, type FormEvent } from "react";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { Confirmar, Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { formatarData } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { ROTULO_REDE, ROTULO_STATUS_CONTEUDO } from "./comum";

interface Conteudo {
  id: string; unidadeId: string | null; titulo: string; rede: string; status: string; dataPrevista: string | null;
  legenda: string | null; link: string | null; responsavelId: string | null; responsavel: string | null;
}
interface Responsavel { id: string; nome: string }

const CLASSE_STATUS: Record<string, string> = { IDEIA: "etiqueta--neutra", PRODUCAO: "etiqueta--atencao", AGENDADO: "etiqueta--info", PUBLICADO: "etiqueta--sucesso" };

function FormConteudo({ conteudo, responsaveis, aoSalvar, aoCancelar }: { conteudo: Conteudo | null; responsaveis: Responsavel[]; aoSalvar: () => Promise<void>; aoCancelar: () => void }) {
  const { unidades, praca, usuario } = useSessao();
  const todas = !!usuario?.todasUnidades;
  const [titulo, setTitulo] = useState(conteudo?.titulo ?? "");
  const [rede, setRede] = useState(conteudo?.rede ?? "INSTAGRAM");
  const [status, setStatus] = useState(conteudo?.status ?? "IDEIA");
  const [data, setData] = useState(conteudo?.dataPrevista ?? "");
  const [responsavelId, setResponsavelId] = useState(conteudo?.responsavelId ?? "");
  const [unidadeId, setUnidadeId] = useState(conteudo ? (conteudo.unidadeId ?? "") : (praca || (todas ? "" : (unidades[0]?.id ?? ""))));
  const [legenda, setLegenda] = useState(conteudo?.legenda ?? "");
  const [link, setLink] = useState(conteudo?.link ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (titulo.trim().length < 2) return setErro("Informe o título.");
    if (link.trim() && !/^https:\/\//i.test(link.trim())) return setErro("O link deve começar com https://");
    setSalvando(true);
    try {
      const corpo = { titulo: titulo.trim(), rede, status, dataPrevista: data || null, responsavelId: responsavelId || null, unidadeId: unidadeId || null, legenda: legenda.trim() || null, link: link.trim() || null };
      if (conteudo) await api.patch(`/api/marketing/conteudos/${conteudo.id}`, corpo);
      else await api.post("/api/marketing/conteudos", corpo);
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
        <div className="campo campo--largo"><label htmlFor="ct-titulo">Título</label><input id="ct-titulo" value={titulo} maxLength={160} onChange={(e) => setTitulo(e.target.value)} /></div>
        <div className="campo"><label htmlFor="ct-rede">Rede</label><select id="ct-rede" value={rede} onChange={(e) => setRede(e.target.value)}>{Object.entries(ROTULO_REDE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="campo"><label htmlFor="ct-status">Situação</label><select id="ct-status" value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(ROTULO_STATUS_CONTEUDO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="campo"><label htmlFor="ct-data">Data prevista</label><input id="ct-data" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
        <div className="campo"><label htmlFor="ct-resp">Responsável</label><select id="ct-resp" value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}><option value="">Sem responsável</option>{responsaveis.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</select></div>
        <div className="campo"><label htmlFor="ct-praca">Praça</label><select id="ct-praca" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>{todas && <option value="">Todas as praças</option>}{unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></div>
        <div className="campo campo--largo"><label htmlFor="ct-link">Link da publicação (opcional)</label><input id="ct-link" type="url" value={link} maxLength={500} onChange={(e) => setLink(e.target.value)} placeholder="https://" /></div>
        <div className="campo campo--largo"><label htmlFor="ct-legenda">Legenda / roteiro</label><textarea id="ct-legenda" rows={4} value={legenda} maxLength={2200} onChange={(e) => setLegenda(e.target.value)} /></div>
      </div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : conteudo ? "Salvar" : "Criar"}</button>
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
  const [excluir, setExcluir] = useState<Conteudo | null>(null);

  async function mudarStatus(c: Conteudo, novo: string) {
    try {
      await api.patch(`/api/marketing/conteudos/${c.id}`, { status: novo });
      await lista.recarregar();
    } catch (x) {
      notificar(mensagemDeErro(x), "erro");
    }
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

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Calendário de conteúdo</h1>
          <p className="pagina__descricao">Posts por rede, da ideia à publicação, com responsável e data prevista.</p>
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
                  <td>{c.link ? <a href={c.link} target="_blank" rel="noopener noreferrer">{c.titulo}</a> : c.titulo}</td>
                  <td>{ROTULO_REDE[c.rede] ?? c.rede}</td>
                  <td>
                    {podeGerenciar ? (
                      <select aria-label={`Situação de ${c.titulo}`} value={c.status} onChange={(e) => void mudarStatus(c, e.target.value)}>{Object.entries(ROTULO_STATUS_CONTEUDO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    ) : <span className={`etiqueta ${CLASSE_STATUS[c.status] ?? ""}`}>{ROTULO_STATUS_CONTEUDO[c.status] ?? c.status}</span>}
                  </td>
                  <td>{c.responsavel ?? <span className="texto-fraco">—</span>}</td>
                  <td className="sem-quebra">
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
        {form && <FormConteudo conteudo={form.conteudo} responsaveis={resp.dados ?? []} aoCancelar={() => setForm(null)} aoSalvar={async () => { setForm(null); notificar("Conteúdo salvo."); await lista.recarregar(); }} />}
      </Modal>
      <Confirmar aberto={!!excluir} titulo="Excluir conteúdo" perigo textoConfirmar="Excluir" aoFechar={() => setExcluir(null)} aoConfirmar={() => void confirmarExclusao()} mensagem={<>Excluir <strong>{excluir?.titulo}</strong> do calendário?</>} />
    </div>
  );
}
