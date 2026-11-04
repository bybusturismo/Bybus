import { useEffect, useState } from "react";
import { api, mensagemDeErro } from "../api/cliente";
import { IDS_GESTORES } from "../api/tipos";
import type { AcaoIa, AvaliacaoDetalheIa, AvaliacaoResumoIa, EstadoIa, IdGestor, ItemIa, ParecerAvaliacao, ParecerDebate, RetratosIa, StatusAcaoIa, StatusAvaliacaoIa } from "../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Icone } from "../componentes/Icone";
import { useNotificar } from "../componentes/Notificacoes";
import { formatarDataCurta, formatarDataHora } from "../util/formato";
import { ROTULO_GESTOR } from "../util/rotulos";
import { useCarregar } from "../util/useCarregar";

type Aba = "painel" | "gestores" | "conversa" | "acoes" | "historico";
const ABAS: Array<[Aba, string]> = [
  ["painel", "Painel do dia"],
  ["gestores", "Cada gestor"],
  ["conversa", "A conversa entre eles"],
  ["acoes", "Ações"],
  ["historico", "Histórico"],
];

const ROTULO_NIVEL: Record<string, string> = { baixa: "baixa", media: "média", alta: "alta", baixo: "baixo", medio: "médio", alto: "alto" };
const ROTULO_STATUS_AVALIACAO: Record<StatusAvaliacaoIa, string> = { EXECUTANDO: "Em andamento", CONCLUIDA: "Concluída", PARCIAL: "Concluída com falhas", FALHA: "Falhou", LIMITE: "Parou no limite mensal" };
const ROTULO_STATUS_ACAO: Record<StatusAcaoIa, string> = { SUGERIDA: "Sugerida", APROVADA: "Aprovada", CONCLUIDA: "Concluída", DESCARTADA: "Descartada" };
const ROTULO_TIPO_COMENTARIO = { concordo: "concorda", complemento: "complementa", discordo: "discorda" } as const;

const usd = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;

function Nivel({ valor }: { valor: string }) {
  const classe = valor === "alta" || valor === "alto" ? "alta" : valor === "media" || valor === "medio" ? "media" : "baixa";
  return <span className={`etiqueta etiqueta--grav-${classe}`}>{ROTULO_NIVEL[valor] ?? valor}</span>;
}

function ListaItens({ itens, vazio }: { itens: ItemIa[]; vazio: string }) {
  if (itens.length === 0) return <p className="texto-fraco">{vazio}</p>;
  return (
    <ul className="ia-lista">
      {itens.map((i, k) => (
        <li key={k} className="ia-item">
          <span className="ia-item__titulo">{i.titulo}</span> <Nivel valor={i.gravidade ?? i.impacto ?? "baixa"} />
          <p className="ia-item__detalhe">{i.detalhe}</p>
          {i.evidencia && <p className="ia-item__meta">Base: {i.evidencia}</p>}
        </li>
      ))}
    </ul>
  );
}

function ListaAcoes({ acoes, aoDecidir, ocupado }: { acoes: AcaoIa[]; aoDecidir: (a: AcaoIa, s: "APROVADA" | "DESCARTADA" | "CONCLUIDA") => void; ocupado: string | null }) {
  if (acoes.length === 0) return <p className="texto-fraco">Nenhuma ação nesta lista.</p>;
  return (
    <ul className="ia-lista">
      {acoes.map((a) => (
        <li key={a.id} className="ia-item">
          <span className="ia-item__titulo">{a.titulo}</span> <Nivel valor={a.prioridade} />
          <span className={`etiqueta etiqueta--ia-${a.status.toLowerCase()}`}>{ROTULO_STATUS_ACAO[a.status]}</span>
          <p className="ia-item__detalhe">{a.detalhe}</p>
          <p className="ia-item__meta">
            Área: {ROTULO_GESTOR[a.area] ?? a.area}
            {a.prazoDias != null && ` · prazo sugerido: ${a.prazoDias} dia(s)`}
            {a.decididaEm && ` · decidida em ${formatarDataHora(a.decididaEm)}`}
          </p>
          <div className="ia-item__acoes">
            {a.status === "SUGERIDA" && (
              <>
                <button type="button" className="botao botao--sucesso botao--pequeno" disabled={ocupado === a.id} onClick={() => aoDecidir(a, "APROVADA")} aria-label={`Aprovar: ${a.titulo}`}>
                  <Icone nome="check" tamanho={16} /> Aprovar
                </button>
                <button type="button" className="botao botao--secundario botao--pequeno" disabled={ocupado === a.id} onClick={() => aoDecidir(a, "DESCARTADA")} aria-label={`Descartar: ${a.titulo}`}>
                  <Icone nome="x" tamanho={16} /> Descartar
                </button>
              </>
            )}
            {a.status === "APROVADA" && (
              <>
                <button type="button" className="botao botao--sucesso botao--pequeno" disabled={ocupado === a.id} onClick={() => aoDecidir(a, "CONCLUIDA")} aria-label={`Marcar como concluída: ${a.titulo}`}>
                  <Icone nome="check" tamanho={16} /> Marcar como concluída
                </button>
                <button type="button" className="botao botao--secundario botao--pequeno" disabled={ocupado === a.id} onClick={() => aoDecidir(a, "DESCARTADA")} aria-label={`Descartar: ${a.titulo}`}>
                  Descartar
                </button>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Gestores() {
  const notificar = useNotificar();
  const [aba, setAba] = useState<Aba>("painel");
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [gestor, setGestor] = useState<IdGestor>("comercial");
  const [filtroAcoes, setFiltroAcoes] = useState<StatusAcaoIa | "">("");
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const estado = useCarregar((s) => api.get<EstadoIa>("/api/ia/estado", s), []);
  const historico = useCarregar((s) => api.get<AvaliacaoResumoIa[]>("/api/ia/avaliacoes", s), []);
  const idAtual = escolhida ?? historico.dados?.[0]?.id ?? null;
  const detalhe = useCarregar((s) => (idAtual ? api.get<AvaliacaoDetalheIa>(`/api/ia/avaliacoes/${idAtual}`, s) : Promise.resolve(null)), [idAtual]);
  const indicadores = useCarregar((s) => api.get<RetratosIa>("/api/ia/retratos", s), []);
  const acoes = useCarregar((s) => api.get<AcaoIa[]>(`/api/ia/acoes${filtroAcoes ? `?status=${filtroAcoes}` : ""}`, s), [filtroAcoes]);

  const emAndamento = detalhe.dados?.status === "EXECUTANDO" || estado.dados?.emAndamento === true || rodando;

  // Enquanto a avaliação roda (leva alguns minutos), consulta o andamento a cada 4 segundos.
  useEffect(() => {
    if (!emAndamento) return;
    const t = setInterval(() => {
      void estado.recarregar();
      void historico.recarregar();
      void detalhe.recarregar();
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emAndamento]);

  useEffect(() => {
    if (rodando && detalhe.dados && detalhe.dados.status !== "EXECUTANDO") setRodando(false);
  }, [rodando, detalhe.dados]);

  async function rodarAgora() {
    setErro(null);
    setRodando(true);
    try {
      const r = await api.post<{ id: string }>("/api/ia/avaliacoes");
      setEscolhida(r.id);
      setAba("painel");
      notificar("Avaliação iniciada. Leva alguns minutos.");
      await historico.recarregar();
      await estado.recarregar();
    } catch (e) {
      setRodando(false);
      setErro(mensagemDeErro(e));
    }
  }

  async function decidir(a: AcaoIa, status: "APROVADA" | "DESCARTADA" | "CONCLUIDA") {
    setOcupado(a.id);
    try {
      await api.patch(`/api/ia/acoes/${a.id}`, { status });
      notificar(status === "APROVADA" ? "Ação aprovada." : status === "CONCLUIDA" ? "Ação concluída." : "Ação descartada.");
      await Promise.all([detalhe.recarregar(), acoes.recarregar(), historico.recarregar()]);
    } catch (e) {
      notificar(mensagemDeErro(e), "erro");
    } finally {
      setOcupado(null);
    }
  }

  if (estado.carregando && !estado.dados) return <Carregando />;
  if (estado.erro) return <ErroCarga mensagem={estado.erro} tentarDeNovo={estado.recarregar} />;
  const e = estado.dados!;
  const av = detalhe.dados;
  const alertasDoDia = indicadores.dados ? IDS_GESTORES.flatMap((g) => (indicadores.dados!.retratos[g]?.alertas ?? []).map((t) => ({ g, t }))) : [];
  const parecer = (g: IdGestor, rodada: 1 | 2) => av?.pareceres.find((p) => p.gestor === g && p.rodada === rodada)?.conteudo;
  const limite = e.limiteMesUsd ?? 0;

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Gestores de IA</h1>
          <p className="pagina__descricao">Oito gestores avaliam a operação todo dia, conversam entre si e entregam uma síntese. As ações só viram tarefa quando uma pessoa aprova.</p>
        </div>
        <div className="barra-acoes">
          <button type="button" className="botao botao--primario" onClick={() => void rodarAgora()} disabled={!e.ligada || emAndamento}>
            <Icone nome="faisca" tamanho={18} /> {emAndamento ? "Avaliando…" : "Rodar agora"}
          </button>
        </div>
      </div>

      {!e.ligada && (
        <Aviso tipo="atencao" titulo="IA desligada">
          A chave da Anthropic (ANTHROPIC_API_KEY) ainda não foi configurada. Os indicadores abaixo continuam funcionando, calculados direto do banco; os gestores e o Turistinha ficam parados até a chave ser configurada.
        </Aviso>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <p className="ia-estado">
        <span>
          Avaliação diária: <strong>{e.ligada && e.avaliacaoDiaria ? `ligada, às ${e.horario}` : "desligada"}</strong>
        </span>
        <span>
          Gasto no mês: <strong>{usd(e.gastoMesUsd ?? 0)}</strong>
          {limite > 0 && ` de ${usd(limite)}`}
        </span>
        {e.modelo && (
          <span>
            Modelo: {e.modelo}
            {e.modeloSintese && e.modeloSintese !== e.modelo ? ` (síntese: ${e.modeloSintese})` : ""}
          </span>
        )}
      </p>

      <div className="abas" role="tablist" aria-label="Gestores de IA">
        {ABAS.map(([k, rotulo]) => (
          <button key={k} type="button" role="tab" id={`aba-${k}`} aria-selected={aba === k} aria-controls={`painel-${k}`} className={`aba${aba === k ? " aba--ativa" : ""}`} onClick={() => setAba(k)}>
            {rotulo}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`painel-${aba}`} aria-labelledby={`aba-${aba}`}>
        {aba === "painel" && (
          <>
            {emAndamento && !av?.sintese && <Aviso tipo="info">Os gestores estão avaliando e conversando. Esta tela atualiza sozinha.</Aviso>}
            {av && av.status !== "EXECUTANDO" && av.status !== "CONCLUIDA" && (
              <Aviso tipo={av.status === "FALHA" ? "erro" : "atencao"} titulo={ROTULO_STATUS_AVALIACAO[av.status]}>
                {av.erro ?? "Veja o histórico para detalhes."}
              </Aviso>
            )}
            {av?.sintese ? (
              <>
                <section className="cartao" aria-label="Resumo do dia">
                  <p className="ia-item__meta">
                    Avaliação de {formatarDataCurta(av.dataRef)} · {av.origem === "AUTOMATICA" ? "automática" : "manual"} · {usd(av.custoUsd)}
                  </p>
                  <p className="ia-resumo">{av.sintese.resumo}</p>
                  {av.sintese.pontos_de_discordia.length > 0 && (
                    <>
                      <h3 className="subtitulo">Pontos em aberto entre os gestores</h3>
                      <ul>
                        {av.sintese.pontos_de_discordia.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
                <div className="ia-grade">
                  <section className="cartao" aria-label="Vulnerabilidades">
                    <h2>Vulnerabilidades</h2>
                    <ListaItens itens={av.sintese.vulnerabilidades} vazio="Nenhuma vulnerabilidade apontada." />
                  </section>
                  <section className="cartao" aria-label="Oportunidades de crescimento">
                    <h2>Oportunidades de crescimento</h2>
                    <ListaItens itens={av.sintese.oportunidades} vazio="Nenhuma oportunidade apontada." />
                  </section>
                </div>
                <section className="cartao" aria-label="Ações sugeridas">
                  <h2>Ações sugeridas</h2>
                  <p className="texto-fraco">A IA só sugere. Nada vira tarefa ou aviso até você aprovar.</p>
                  <ListaAcoes acoes={av.acoes} aoDecidir={(a, s) => void decidir(a, s)} ocupado={ocupado} />
                </section>
              </>
            ) : (
              !emAndamento && (
                <Vazio titulo="Ainda não há avaliação concluída.">
                  {e.ligada ? "Clique em “Rodar agora” ou aguarde a avaliação automática do dia." : "Configure a chave da IA para ativar os gestores."}
                </Vazio>
              )
            )}
            <section className="cartao" aria-label="Alertas calculados dos dados">
              <h2>Alertas dos dados de hoje</h2>
              <p className="texto-fraco">Calculados direto do banco, sem IA.</p>
              {indicadores.carregando && !indicadores.dados ? (
                <Carregando />
              ) : indicadores.erro ? (
                <Aviso tipo="erro">{indicadores.erro}</Aviso>
              ) : alertasDoDia.length === 0 ? (
                <p className="texto-fraco">Nenhum alerta hoje.</p>
              ) : (
                <ul className="ia-lista">
                  {alertasDoDia.map((a, i) => (
                    <li key={i}>
                      <span className="etiqueta etiqueta--neutra">{ROTULO_GESTOR[a.g]}</span> {a.t}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {aba === "gestores" && (
          <>
            <div className="ia-seletor" role="group" aria-label="Escolha o gestor">
              {IDS_GESTORES.map((g) => (
                <button key={g} type="button" className={`botao botao--pequeno ${gestor === g ? "botao--primario" : "botao--secundario"}`} aria-pressed={gestor === g} onClick={() => setGestor(g)}>
                  {ROTULO_GESTOR[g]}
                </button>
              ))}
            </div>
            {!av ? (
              <Vazio titulo="Ainda não há avaliação concluída." />
            ) : (
              (() => {
                const p = parecer(gestor, 1) as ParecerAvaliacao | undefined;
                const retr = av.retratos?.[gestor]?.alertas ?? [];
                return (
                  <>
                    <section className="cartao">
                      <h2>{ROTULO_GESTOR[gestor]}</h2>
                      {retr.length > 0 && (
                        <>
                          <h3>Alertas dos dados</h3>
                          <ul>
                            {retr.map((t, i) => (
                              <li key={i}>{t}</li>
                            ))}
                          </ul>
                        </>
                      )}
                      {!p ? <Aviso tipo="atencao">Este gestor não entregou avaliação nesta rodada.</Aviso> : <ListaItens itens={p.achados} vazio="Sem achados." />}
                    </section>
                    {p && (
                      <div className="ia-grade">
                        <section className="cartao">
                          <h3>Vulnerabilidades</h3>
                          <ListaItens itens={p.vulnerabilidades} vazio="Nenhuma." />
                        </section>
                        <section className="cartao">
                          <h3>Oportunidades</h3>
                          <ListaItens itens={p.oportunidades} vazio="Nenhuma." />
                        </section>
                        <section className="cartao">
                          <h3>Ações que sugere</h3>
                          {p.acoes_sugeridas.length === 0 ? (
                            <p className="texto-fraco">Nenhuma.</p>
                          ) : (
                            <ul className="ia-lista">
                              {p.acoes_sugeridas.map((a, i) => (
                                <li key={i} className="ia-item">
                                  <span className="ia-item__titulo">{a.titulo}</span> <Nivel valor={a.prioridade} />
                                  <p className="ia-item__detalhe">{a.detalhe}</p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                      </div>
                    )}
                  </>
                );
              })()
            )}
          </>
        )}

        {aba === "conversa" &&
          (!av ? (
            <Vazio titulo="Ainda não há conversa." />
          ) : (
            <>
              <p className="texto-fraco">Depois de avaliar a própria área, cada gestor leu os achados dos outros e comentou.</p>
              <div className="ia-lista">
                {IDS_GESTORES.flatMap((g) => {
                  const d = parecer(g, 2) as ParecerDebate | undefined;
                  return (d?.comentarios ?? []).map((c, i) => (
                    <div key={`${g}-${i}`} className="ia-fala">
                      <p className="ia-fala__quem">
                        {ROTULO_GESTOR[g]} {ROTULO_TIPO_COMENTARIO[c.tipo]} com {ROTULO_GESTOR[c.gestor] ?? c.gestor}
                      </p>
                      <p>{c.texto}</p>
                    </div>
                  ));
                })}
              </div>
              <section className="cartao" aria-label="Riscos que cruzam áreas">
                <h2>Riscos que cruzam áreas</h2>
                {(() => {
                  const riscos = IDS_GESTORES.flatMap((g) => ((parecer(g, 2) as ParecerDebate | undefined)?.riscos_cruzados ?? []).map((r) => ({ g, r })));
                  if (riscos.length === 0) return <p className="texto-fraco">Nenhum risco cruzado apontado.</p>;
                  return (
                    <ul className="ia-lista">
                      {riscos.map(({ g, r }, i) => (
                        <li key={i} className="ia-item">
                          <span className="ia-item__titulo">{r.titulo}</span>
                          <p className="ia-item__detalhe">{r.detalhe}</p>
                          <p className="ia-item__meta">
                            Apontado por {ROTULO_GESTOR[g]} · áreas: {r.areas.map((a) => ROTULO_GESTOR[a] ?? a).join(", ")}
                          </p>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </section>
            </>
          ))}

        {aba === "acoes" && (
          <>
            <div className="filtros">
              <div className="campo">
                <label htmlFor="filtro-acoes">Situação</label>
                <select id="filtro-acoes" value={filtroAcoes} onChange={(ev) => setFiltroAcoes(ev.target.value as StatusAcaoIa | "")}>
                  <option value="">Todas</option>
                  {(Object.keys(ROTULO_STATUS_ACAO) as StatusAcaoIa[]).map((s) => (
                    <option key={s} value={s}>
                      {ROTULO_STATUS_ACAO[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <section className="cartao">
              {acoes.carregando && !acoes.dados ? <Carregando /> : acoes.erro ? <ErroCarga mensagem={acoes.erro} tentarDeNovo={acoes.recarregar} /> : <ListaAcoes acoes={acoes.dados ?? []} aoDecidir={(a, s) => void decidir(a, s)} ocupado={ocupado} />}
            </section>
          </>
        )}

        {aba === "historico" && (
          <section className="cartao">
            {historico.carregando && !historico.dados ? (
              <Carregando />
            ) : (historico.dados ?? []).length === 0 ? (
              <Vazio titulo="Nenhuma avaliação ainda." />
            ) : (
              <div className="tabela-rolagem">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Dia</th>
                      <th>Origem</th>
                      <th>Situação</th>
                      <th>Ações (aprovadas/total)</th>
                      <th>Custo</th>
                      <th>
                        <span className="visualmente-oculto">Abrir</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {historico.dados!.map((h) => {
                      const total = Object.values(h.acoes).reduce((s, n) => s + (n ?? 0), 0);
                      return (
                        <tr key={h.id}>
                          <td>{formatarDataCurta(h.dataRef)}</td>
                          <td>{h.origem === "AUTOMATICA" ? "Automática" : "Manual"}</td>
                          <td>{ROTULO_STATUS_AVALIACAO[h.status]}</td>
                          <td>
                            {(h.acoes.APROVADA ?? 0) + (h.acoes.CONCLUIDA ?? 0)}/{total}
                          </td>
                          <td>{usd(h.custoUsd)}</td>
                          <td>
                            <button
                              type="button"
                              className="botao botao--secundario botao--pequeno"
                              onClick={() => {
                                setEscolhida(h.id);
                                setAba("painel");
                              }}
                            >
                              Ver
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
