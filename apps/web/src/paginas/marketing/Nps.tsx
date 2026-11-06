import { useState, type FormEvent } from "react";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Indicador, Indicadores } from "../../componentes/Indicador";
import { Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { CabecalhoPagina } from "../../componentes/Pagina";
import { VerPublica } from "../../componentes/VerPublica";
import { useSessao } from "../../sessao/Sessao";
import { formatarData, formatarNumero, nomeMes } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { BarrasLista, FiltroPeriodo, usePeriodo } from "./comum";
import { NpsPublico } from "../publico/NpsPublico";

interface Grupo { chave: string; total: number; promotores: number; neutros: number; detratores: number; nps: number | null }
interface Painel { geral: Grupo & { enviados: number; taxaResposta: number | null; aceitaramConvite: number }; porMes: Grupo[]; porPasseio: Grupo[]; porGuia: Grupo[] }
interface Caso { id: string; reservaId: string; nota: number; comentario: string | null; titular: string; data: string; passeio: string; guia: string | null; casoStatus: string; casoNota: string | null; responsavel: string | null }
const STATUS: Record<string, string> = { ABERTO: "Aberto", EM_TRATATIVA: "Em tratativa", RESOLVIDO: "Resolvido" };

function Tabela({ titulo, linhas, rotulo }: { titulo: string; linhas: Grupo[]; rotulo?: (c: string) => string }) {
  return (
    <section className="cartao" aria-label={titulo}>
      <h2>{titulo}</h2>
      {linhas.length === 0 ? <p className="texto-fraco">Sem respostas no período.</p> : (
        <div className="tabela-rolagem"><table className="tabela"><thead><tr><th>{titulo.replace("NPS por ", "")}</th><th className="num">Respostas</th><th className="num">NPS</th></tr></thead>
          <tbody>{linhas.map((l) => <tr key={l.chave}><td>{rotulo ? rotulo(l.chave) : l.chave}</td><td className="num">{l.total}</td><td className="num"><strong>{l.nps ?? "—"}</strong></td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}

function CasoForm({ caso, aoSalvar, aoCancelar }: { caso: Caso; aoSalvar: () => Promise<void>; aoCancelar: () => void }) {
  const [status, setStatus] = useState(caso.casoStatus);
  const [nota, setNota] = useState(caso.casoNota ?? "");
  const [erro, setErro] = useState<string | null>(null);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    try { await api.patch(`/api/marketing/nps/casos/${caso.id}`, { casoStatus: status, casoNota: nota.trim() || null }); await aoSalvar(); } catch (x) { setErro(mensagemDeErro(x)); }
  }
  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <p><strong>Nota {caso.nota}</strong> de {caso.titular} — {caso.passeio} em {formatarData(caso.data)}</p>
      {caso.comentario && <p className="texto-copiavel">{caso.comentario}</p>}
      <div className="campo"><label htmlFor="cs-st">Situação</label><select id="cs-st" value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="campo"><label htmlFor="cs-nt">Anotações do atendimento (sem dados pessoais)</label><textarea id="cs-nt" rows={4} maxLength={2000} value={nota} onChange={(e) => setNota(e.target.value)} /></div>
      <p className="texto-fraco">O contato do cliente está na reserva (Listagem de reservas).</p>
      <div className="modal__acoes"><button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button><button type="submit" className="botao botao--primario">Salvar</button></div>
    </form>
  );
}

export function Nps() {
  const { praca, pode } = useSessao();
  const notificar = useNotificar();
  const gerencia = pode("marketing:gerenciar");
  const [periodo, setPeriodo] = usePeriodo(90, 0);
  const consulta = qs({ de: periodo.de, ate: periodo.ate, unidadeId: praca });
  const painel = useCarregar((s) => api.get<Painel>(`/api/marketing/nps${consulta}`, s), [consulta]);
  const casos = useCarregar((s) => api.get<Caso[]>("/api/marketing/nps/casos", s), []);
  const [aberto, setAberto] = useState<Caso | null>(null);
  const p = painel.dados;
  const abertos = (casos.dados ?? []).filter((c) => c.casoStatus === "ABERTO").length;
  return (
    <div className="pagina">
      <CabecalhoPagina titulo="NPS pós-passeio" descricao="Uma pergunta (0 a 10) no dia seguinte ao passeio. Nota 0 a 6 abre um caso interno. O convite de avaliação pública vai para todos que concordarem, qualquer que seja a nota."
        filtros={<FiltroPeriodo periodo={periodo} aoMudar={setPeriodo} />}
        acoes={<VerPublica titulo="Página pública do NPS" caminho="/nps/…"><NpsPublico token="demonstracao-nps-ficticio-0000" incorporado /></VerPublica>} />
      {painel.carregando && !p ? <Carregando /> : painel.erro ? <ErroCarga mensagem={painel.erro} tentarDeNovo={painel.recarregar} /> : p ? (
        <>
          <Indicadores rotulo="NPS do período">
            <Indicador tinta="azul" icone="estrela" rotulo="NPS" valor={p.geral.nps ?? "—"} detalhe={`${formatarNumero(p.geral.total)} resposta(s)`} />
            <Indicador tinta="verde" icone="check" rotulo="Promotores (9–10)" valor={formatarNumero(p.geral.promotores)} detalhe={`${formatarNumero(p.geral.neutros)} neutros (7–8)`} />
            <Indicador tinta="rosa" icone="alerta" rotulo="Detratores (0–6)" valor={formatarNumero(p.geral.detratores)} />
            <Indicador tinta="laranja" icone="mensagem" rotulo="Taxa de resposta" valor={p.geral.taxaResposta == null ? "—" : `${p.geral.taxaResposta.toLocaleString("pt-BR")}%`} detalhe={`${formatarNumero(p.geral.enviados)} enviadas · ${formatarNumero(p.geral.aceitaramConvite)} aceitaram o convite`} />
          </Indicadores>
          {p.porMes.length > 0 && <section className="cartao" aria-labelledby="np-m"><h2 id="np-m">NPS por mês</h2><BarrasLista itens={p.porMes.map((m) => ({ rotulo: nomeMes(m.chave, "short"), valor: m.nps ?? 0 }))} /></section>}
          <div className="m2-grade"><Tabela titulo="NPS por passeio" linhas={p.porPasseio} /><Tabela titulo="NPS por guia" linhas={p.porGuia} /></div>
        </>
      ) : null}
      <section className="cartao" aria-labelledby="np-c">
        <h2 id="np-c">Casos internos {abertos > 0 && <span className="m2-aviso-contador" aria-label={`${abertos} aberto(s)`}>{abertos}</span>}</h2>
        {casos.carregando && !casos.dados ? <Carregando /> : casos.erro ? <ErroCarga mensagem={casos.erro} tentarDeNovo={casos.recarregar} /> : (casos.dados ?? []).length === 0 ? <Vazio titulo="Nenhum caso aberto." /> : (
          <div className="tabela-rolagem"><table className="tabela"><thead><tr><th>Passeio</th><th className="num">Nota</th><th>Comentário</th><th>Situação</th><th><span className="visualmente-oculto">Ações</span></th></tr></thead>
            <tbody>{(casos.dados ?? []).map((c) => (
              <tr key={c.id}><td className="sem-quebra">{formatarData(c.data)}<div className="texto-fraco">{c.passeio} · {c.titular}{c.guia ? ` · guia ${c.guia}` : ""}</div></td><td className="num"><strong>{c.nota}</strong></td><td>{c.comentario ?? <span className="texto-fraco">sem comentário</span>}</td>
                <td><span className={`etiqueta ${c.casoStatus === "ABERTO" ? "etiqueta--perigo" : c.casoStatus === "RESOLVIDO" ? "etiqueta--sucesso" : "etiqueta--atencao"}`}>{STATUS[c.casoStatus]}</span></td>
                <td>{gerencia && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setAberto(c)}>Tratar</button>}</td></tr>))}</tbody></table></div>
        )}
      </section>
      <Modal aberto={!!aberto} titulo="Caso interno" aoFechar={() => setAberto(null)}>
        {aberto && <CasoForm caso={aberto} aoCancelar={() => setAberto(null)} aoSalvar={async () => { setAberto(null); notificar("Caso atualizado."); await casos.recarregar(); }} />}
      </Modal>
    </div>
  );
}
