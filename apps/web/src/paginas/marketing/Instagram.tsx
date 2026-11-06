import { useId, useState } from "react";
import { NOMES_DIA_SEMANA, type MelhoresHorarios } from "@bybus/core";
import "../../estilos/visao-geral.css";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { CabecalhoPagina, FaixaNumeros } from "../../componentes/Pagina";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { formatarDataHora, formatarNumero } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { Legenda, TabelaAlternativa, tetoDoEixo } from "../visao-geral/graficos";
import { BarraProporcao, FiltroPeriodo, usePeriodo } from "./comum";

interface PostRanking {
  id: string; tipo: string; legenda: string | null; link: string | null; publicadoEm: string | null; curtidas: number | null; comentarios: number | null;
  salvamentos: number | null; compartilhamentos: number | null; alcance: number | null; engajamento: number; taxa: number | null;
}
export interface PainelInstagram {
  modo: { conectado: boolean; real: boolean; simulado: boolean; avisosLigados: boolean };
  periodo: { de: string; ate: string };
  atualizadoEm: string | null;
  resumo: { seguidores: number | null; variacaoSeguidores: number | null; alcance: number; visualizacoes: number; visitasPerfil: number; cliquesSite: number; posts: number; engajamento: number };
  serie: Array<{ data: string; seguidores: number | null; alcance: number | null }>;
  ranking: PostRanking[];
  melhores: MelhoresHorarios;
}

const ROTULO_TIPO: Record<string, string> = { IMAGEM: "Imagem", VIDEO: "Vídeo", CARROSSEL: "Carrossel", REELS: "Reels", STORY: "Story" };
const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const L = 640;
const A = 170;
const M = { e: 48, d: 8, t: 10, b: 24 };

/** Linha diária em SVG à mão (mesmo estilo da Visão Geral): título, descrição e tabela equivalente. */
function LinhaDiaria({ titulo, descricao, pontos, classe, rotuloSerie, ajustarEixo = false }: { titulo: string; descricao: string; pontos: Array<{ data: string; valor: number | null }>; classe: string; rotuloSerie: string; ajustarEixo?: boolean }) {
  const id = useId();
  const validos = pontos.filter((p) => p.valor !== null) as Array<{ data: string; valor: number }>;
  if (validos.length === 0) return <p className="vg-vazio">Sem dados no período.</p>;
  const minimo = Math.min(...validos.map((p) => p.valor));
  const maximo = Math.max(...validos.map((p) => p.valor));
  // Seguidores variam pouco: o eixo começa perto do menor valor para a evolução aparecer.
  const base = ajustarEixo ? Math.max(0, Math.floor(minimo - (maximo - minimo) * 0.2 - 1)) : 0;
  const teto = ajustarEixo ? Math.max(base + 1, maximo + Math.ceil((maximo - minimo) * 0.1)) : tetoDoEixo(maximo);
  const largUtil = L - M.e - M.d;
  const passo = largUtil / Math.max(1, pontos.length - 1);
  const x = (i: number) => M.e + (pontos.length === 1 ? largUtil / 2 : passo * i);
  const altUtil = A - M.t - M.b;
  const y = (v: number) => M.t + altUtil - ((v - base) / Math.max(1, teto - base)) * altUtil;
  const cada = Math.max(1, Math.ceil(pontos.length / 8));
  const coords = pontos.map((p, i) => (p.valor === null ? null : `${x(i)},${y(p.valor)}`)).filter(Boolean).join(" ");
  const formato = (n: number) => formatarNumero(Math.round(n));
  return (
    <figure className="vg-figura">
      <svg viewBox={`0 0 ${L} ${A}`} role="img" aria-labelledby={`${id}-t ${id}-d`} className="vg-svg" preserveAspectRatio="xMidYMid meet">
        <title id={`${id}-t`}>{titulo}</title>
        <desc id={`${id}-d`}>{descricao}</desc>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={M.e} x2={L - M.d} y1={y(base + (teto - base) * f)} y2={y(base + (teto - base) * f)} className="vg-grade-linha" />
            <text x={M.e - 4} y={y(base + (teto - base) * f) + 3} textAnchor="end" className="vg-eixo">{formato(base + (teto - base) * f)}</text>
          </g>
        ))}
        {pontos.map((p, i) => (i % cada === 0 ? <text key={p.data} x={x(i)} y={A - 8} textAnchor="middle" className="vg-eixo">{dataCurta(p.data)}</text> : null))}
        <g className={`vg-linha ${classe}`}>
          <polyline points={coords} fill="none" className="vg-linha__traco" />
          {pontos.map((p, i) => p.valor !== null && (
            <circle key={p.data} cx={x(i)} cy={y(p.valor)} r={pontos.length > 40 ? 2 : 3} className="vg-linha__ponto"><title>{`${dataCurta(p.data)}: ${formato(p.valor)}`}</title></circle>
          ))}
        </g>
      </svg>
      <Legenda series={[{ chave: "s", rotulo: rotuloSerie, classe }]} />
      <TabelaAlternativa id={`${id}-tab`} cabecalho={["Dia", rotuloSerie]} linhas={pontos.map((p) => [dataCurta(p.data), p.valor === null ? "—" : formato(p.valor)])} />
    </figure>
  );
}

function MelhoresHorariosBloco({ m }: { m: MelhoresHorarios }) {
  if (m.porDiaSemana.length === 0) return <p className="vg-vazio">Ainda não há posts no período para comparar.</p>;
  const maxDia = Math.max(1, ...m.porDiaSemana.map((d) => d.engajamentoMedio));
  const maxHora = Math.max(1, ...m.porHora.map((h) => h.engajamentoMedio));
  return (
    <div className="secao-cartoes">
      <div>
        <h3>Por dia da semana</h3>
        <table className="tabela tabela--compacta">
          <thead><tr><th>Dia</th><th className="num">Posts</th><th>Engajamento médio</th></tr></thead>
          <tbody>{m.porDiaSemana.map((d) => <tr key={d.dia}><td>{NOMES_DIA_SEMANA[d.dia]}</td><td className="num">{d.posts}</td><td><BarraProporcao percentual={(d.engajamentoMedio / maxDia) * 100} rotulo={formatarNumero(d.engajamentoMedio)} /></td></tr>)}</tbody>
        </table>
      </div>
      <div>
        <h3>Por hora (horário de Brasília)</h3>
        <table className="tabela tabela--compacta">
          <thead><tr><th>Hora</th><th className="num">Posts</th><th>Engajamento médio</th></tr></thead>
          <tbody>{m.porHora.map((h) => <tr key={h.hora}><td>{String(h.hora).padStart(2, "0")}h</td><td className="num">{h.posts}</td><td><BarraProporcao percentual={(h.engajamentoMedio / maxHora) * 100} rotulo={formatarNumero(h.engajamentoMedio)} /></td></tr>)}</tbody>
        </table>
      </div>
      <p className="texto-fraco secao-cartoes__nota">
        {m.melhor ? <>Melhor combinação (com pelo menos 2 posts): <strong>{NOMES_DIA_SEMANA[m.melhor.dia]}, {String(m.melhor.hora).padStart(2, "0")}h</strong>, engajamento médio {formatarNumero(m.melhor.engajamentoMedio)}.</> : "Ainda não há posts suficientes na mesma combinação de dia e hora para indicar o melhor momento."}
        {" "}Engajamento = curtidas + comentários + salvamentos + compartilhamentos.
      </p>
    </div>
  );
}

export function Instagram() {
  const { pode } = useSessao();
  const notificar = useNotificar();
  const [periodo, setPeriodo] = usePeriodo(30, 0);
  const [atualizando, setAtualizando] = useState(false);
  const painel = useCarregar((s) => api.get<PainelInstagram>(`/api/marketing/instagram?de=${periodo.de}&ate=${periodo.ate}`, s), [periodo.de, periodo.ate]);
  const p = painel.dados;

  async function atualizar() {
    setAtualizando(true);
    try {
      const r = await api.post<{ executou: boolean }>("/api/marketing/instagram/atualizar");
      notificar(r.executou ? "Dados do Instagram atualizados." : "Instagram em modo simulado: nada para ler.");
      await painel.recarregar();
    } catch (e) { notificar(mensagemDeErro(e), "erro"); } finally { setAtualizando(false); }
  }

  return (
    <div className="pagina">
      <CabecalhoPagina
        titulo="Instagram"
        descricao="Números da conta, evolução, posts que mais engajam e melhores momentos para postar."
        filtros={<FiltroPeriodo periodo={periodo} aoMudar={setPeriodo} />}
        acoes={pode("marketing:gerenciar") && <button type="button" className="botao botao--secundario" onClick={() => void atualizar()} disabled={atualizando}><Icone nome="desfazer" /> {atualizando ? "Atualizando…" : "Atualizar agora"}</button>}
      />
      {painel.carregando && !p ? <Carregando /> : painel.erro && !p ? <ErroCarga mensagem={painel.erro} tentarDeNovo={painel.recarregar} /> : p ? (
        <>
          {!p.modo.conectado && <Aviso tipo="info" titulo="Instagram não conectado">Os números aparecem aqui depois que a conta for conectada. O passo a passo está em docs/produto/modulo-instagram.md.</Aviso>}
          {p.modo.conectado && p.modo.simulado && <Aviso tipo="atencao" titulo="Instagram em modo simulado">Fora da produção o sistema só lê o Instagram com INSTAGRAM_ENVIO_REAL=true.</Aviso>}
          {p.serie.length === 0 && p.ranking.length === 0 ? (
            <Vazio titulo="Ainda não há dados do Instagram neste período.">A leitura roda todo dia às 5h30 (ou use “Atualizar agora”).</Vazio>
          ) : (
            <>
              <FaixaNumeros rotulo="Números do período" itens={[
                { rotulo: "Seguidores", valor: p.resumo.seguidores === null ? "—" : formatarNumero(p.resumo.seguidores), detalhe: p.resumo.variacaoSeguidores === null ? undefined : `${p.resumo.variacaoSeguidores >= 0 ? "+" : ""}${formatarNumero(p.resumo.variacaoSeguidores)} no período` },
                { rotulo: "Alcance", valor: formatarNumero(p.resumo.alcance) },
                { rotulo: "Visualizações", valor: formatarNumero(p.resumo.visualizacoes) },
                { rotulo: "Visitas ao perfil", valor: formatarNumero(p.resumo.visitasPerfil) },
                { rotulo: "Cliques no site", valor: formatarNumero(p.resumo.cliquesSite) },
                { rotulo: "Posts", valor: formatarNumero(p.resumo.posts), detalhe: `${formatarNumero(p.resumo.engajamento)} interações` },
              ]} />
              {p.atualizadoEm && <p className="texto-fraco">Última leitura: {formatarDataHora(p.atualizadoEm)}.</p>}
              <div className="secao-cartoes">
                <section className="cartao" aria-labelledby="ig-seg">
                  <h2 id="ig-seg">Evolução de seguidores</h2>
                  <LinhaDiaria titulo="Seguidores por dia" descricao="Quantidade de seguidores da conta em cada dia do período." pontos={p.serie.map((d) => ({ data: d.data, valor: d.seguidores }))} classe="vg-c--SITE" rotuloSerie="Seguidores" ajustarEixo />
                </section>
                <section className="cartao" aria-labelledby="ig-alc">
                  <h2 id="ig-alc">Alcance diário</h2>
                  <LinhaDiaria titulo="Alcance por dia" descricao="Contas alcançadas em cada dia do período." pontos={p.serie.map((d) => ({ data: d.data, valor: d.alcance }))} classe="vg-c--VIATOR" rotuloSerie="Alcance" />
                </section>
              </div>
              <section className="cartao" aria-labelledby="ig-rank">
                <h2 id="ig-rank">Posts que mais engajaram</h2>
                {p.ranking.length === 0 ? <p className="vg-vazio">Nenhum post publicado no período.</p> : (
                  <div className="tabela-rolagem">
                    <table className="tabela tabela--compacta">
                      <thead><tr><th>#</th><th>Post</th><th>Tipo</th><th className="num">Curtidas</th><th className="num">Coment.</th><th className="num">Salvos</th><th className="num">Compart.</th><th className="num">Alcance</th><th className="num">Engajamento</th></tr></thead>
                      <tbody>
                        {p.ranking.map((x, i) => (
                          <tr key={x.id}>
                            <td>{i + 1}</td>
                            <td>{x.link ? <a href={x.link} target="_blank" rel="noopener noreferrer">{x.legenda ?? "(sem legenda)"}</a> : (x.legenda ?? "(sem legenda)")}<br /><span className="texto-fraco">{x.publicadoEm ? formatarDataHora(x.publicadoEm) : ""}</span></td>
                            <td>{ROTULO_TIPO[x.tipo] ?? x.tipo}</td>
                            {[x.curtidas, x.comentarios, x.salvamentos, x.compartilhamentos, x.alcance].map((v, k) => <td key={k} className="num">{v === null ? "—" : formatarNumero(v)}</td>)}
                            <td className="num"><strong>{formatarNumero(x.engajamento)}</strong>{x.taxa !== null && <><br /><span className="texto-fraco">{(x.taxa * 100).toFixed(1).replace(".", ",")}% do alcance</span></>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <section className="cartao" aria-labelledby="ig-hor">
                <h2 id="ig-hor">Melhores dias e horários</h2>
                <MelhoresHorariosBloco m={p.melhores} />
              </section>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
