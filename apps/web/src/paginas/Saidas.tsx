import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, mensagemDeErro, qs } from "../api/cliente";
import type { Passeio, SaidaResumo, UnidadeResumo } from "../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Icone } from "../componentes/Icone";
import { Modal } from "../componentes/Modal";
import { useNotificar } from "../componentes/Notificacoes";
import { nomePraca, useSessao } from "../sessao/Sessao";
import { diferencaDias, formatarData, formatarDataExtenso, hojeIso, intervaloDias, partesData, plural, somarDias } from "../util/formato";
import { ROTULO_STATUS_SAIDA } from "../util/rotulos";
import { EtiquetaLinha } from "../componentes/Etiquetas";
import { Indicador, Indicadores } from "../componentes/Indicador";
import { useCarregar } from "../util/useCarregar";

const DIAS = 14;
const CHAVE_PASSEIO = "bybus.saidas.passeio";

function lerPasseioSalvo(): string {
  try {
    return localStorage.getItem(CHAVE_PASSEIO) ?? "";
  } catch {
    return "";
  }
}

/** Bloco de calendário do dia (decorativo: a data por extenso vem no texto do cartão). */
function BlocoDia({ data, hoje }: { data: string; hoje: string }) {
  const p = partesData(data);
  return (
    <div className={`saida__dia${data === hoje ? " saida__dia--hoje" : ""}`} aria-hidden="true">
      <span className="saida__semana">{p.semana}</span>
      <span className="saida__num">{p.dia}</span>
      <span className="saida__mes">{p.mes}</span>
    </div>
  );
}

/** Totais do período (saídas não canceladas). */
export function resumirPeriodo(saidas: SaidaResumo[], minimoDe: (s: SaidaResumo) => number) {
  const ativas = saidas.filter((s) => s.status !== "CANCELADA");
  const capacidade = ativas.reduce((t, s) => t + s.capacidade, 0);
  return {
    saidas: ativas.length,
    confirmadas: ativas.filter((s) => s.status === "CONFIRMADA").length,
    passageiros: ativas.reduce((t, s) => t + s.passageiros, 0),
    reservas: ativas.reduce((t, s) => t + s.reservas, 0),
    ocupacao: capacidade ? Math.round((ativas.reduce((t, s) => t + s.assentos, 0) / capacidade) * 100) : 0,
    abaixoMinimo: ativas.filter((s) => s.status !== "REALIZADA" && s.pagantes < minimoDe(s)).length,
  };
}

export function rotuloRelativo(data: string, hoje: string): string | null {
  const d = diferencaDias(hoje, data);
  if (d === 0) return "Hoje";
  if (d === 1) return "Amanhã";
  return null;
}

/** Passeios agrupados por praça (para <optgroup>), na ordem das praças do usuário. */
export function agruparPorPraca(passeios: Passeio[], unidades: UnidadeResumo[]): Array<{ praca: string; passeios: Passeio[] }> {
  const grupos = new Map<string, Passeio[]>();
  for (const p of passeios) grupos.set(p.unidadeId, [...(grupos.get(p.unidadeId) ?? []), p]);
  return [...grupos.entries()]
    .map(([id, lista]) => ({ praca: unidades.find((u) => u.id === id)?.nome ?? lista[0]?.unidade ?? "Outra praça", passeios: lista }))
    .sort((a, b) => a.praca.localeCompare(b.praca, "pt-BR"));
}

function OpcoesPasseio({ grupos }: { grupos: Array<{ praca: string; passeios: Passeio[] }> }) {
  if (grupos.length === 1)
    return (
      <>
        {grupos[0]!.passeios.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
      </>
    );
  return (
    <>
      {grupos.map((g) => (
        <optgroup key={g.praca} label={g.praca}>
          {g.passeios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

export function Saidas() {
  const { pode, unidades, praca } = useSessao();
  const notificar = useNotificar();
  const navegar = useNavigate();
  const [params, setParams] = useSearchParams();
  // Vindo de "+ Nova reserva" (Visão Geral): escolher o passeio e a data; a reserva abre no formulário da saída.
  const novaReserva = params.get("acao") === "nova-reserva";
  const hoje = hojeIso();
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(params.get("de") ?? "") ? params.get("de")! : hoje;
  // Período livre (pedido do dono, 04/11): "de" e "até" na URL; padrão 14 dias; no máximo 1 ano.
  const ateParam = params.get("ate") ?? "";
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(ateParam) && ateParam >= inicio && diferencaDias(inicio, ateParam) <= 365 ? ateParam : somarDias(inicio, DIAS - 1);
  const dias = diferencaDias(inicio, fim) + 1;
  /** Muda o período mantendo o tamanho escolhido. */
  const irPara = (de: string, ate = somarDias(de, dias - 1)) => setParams(de === hoje && dias === DIAS ? {} : { de, ate });
  const [passeioSalvo, setPasseioSalvo] = useState<string>(lerPasseioSalvo);
  const [criando, setCriando] = useState<string | null>(null);
  const [erroCriar, setErroCriar] = useState<string | null>(null);
  const [dataNova, setDataNova] = useState("");
  const [passeioNovo, setPasseioNovo] = useState("");
  const [novaAberta, setNovaAberta] = useState(false);

  const passeios = useCarregar((s) => api.get<Passeio[]>("/api/passeios", s), []);
  const daPraca = (passeios.dados ?? []).filter((p) => !praca || p.unidadeId === praca);
  // Antes de os passeios chegarem, já usa o filtro salvo (evita carregar a lista duas vezes ao abrir a tela).
  const filtroPasseio = !passeios.dados ? passeioSalvo : daPraca.some((p) => p.id === passeioSalvo) ? passeioSalvo : "";
  const porId = new Map((passeios.dados ?? []).map((p) => [p.id, p]));
  /** Passeio usado nos botões "Criar saída" de cada dia: o filtrado, ou o único da praça. */
  const passeioDoDia = filtroPasseio ? porId.get(filtroPasseio) ?? null : daPraca.length === 1 ? daPraca[0]! : null;
  const grupos = agruparPorPraca(daPraca, unidades);
  const passeioCriar = daPraca.find((p) => p.id === passeioNovo) ?? passeioDoDia ?? daPraca[0] ?? null;
  const mostrarPraca = !praca && unidades.length > 1;

  const saidas = useCarregar(
    (s) => api.get<SaidaResumo[]>(`/api/saidas${qs({ de: inicio, ate: fim, unidadeId: praca || undefined, passeioId: filtroPasseio || undefined })}`, s),
    [inicio, fim, praca, filtroPasseio],
  );

  function escolherPasseio(id: string) {
    setPasseioSalvo(id);
    try {
      localStorage.setItem(CHAVE_PASSEIO, id);
    } catch {
      /* sem armazenamento: filtro vale só nesta visita */
    }
  }

  async function criarSaida(passeio: Passeio, data: string) {
    setCriando(data);
    setErroCriar(null);
    try {
      const s = await api.post<{ id: string }>("/api/saidas", { passeioId: passeio.id, data });
      notificar(`Saída de ${formatarData(data)} (${passeio.nome}) criada.`);
      if (data >= inicio && data <= fim && (!filtroPasseio || filtroPasseio === passeio.id)) await saidas.recarregar();
      else navegar(`/saidas/${s.id}`);
    } catch (e) {
      setErroCriar(mensagemDeErro(e));
    } finally {
      setCriando(null);
    }
  }

  const porData = new Map<string, SaidaResumo[]>();
  for (const s of saidas.dados ?? []) porData.set(s.data, [...(porData.get(s.data) ?? []), s]);
  const podeCriar = pode("saidas:gerenciar");
  const siglaPraca = (id: string) => unidades.find((u) => u.id === id)?.codigo ?? "";

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Saídas</h1>
          <p className="pagina__descricao">
            {unidades.length > 1 ? nomePraca(unidades, praca) : unidades[0]?.nome ?? ""} · {formatarData(inicio)} a {formatarData(fim)}
          </p>
        </div>
        <div className="barra-acoes">
          {podeCriar && passeioCriar && (
            <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setNovaAberta(true)}>
              <Icone nome="mais" tamanho={16} /> Nova saída
            </button>
          )}
          <div className="campo campo--linha periodo">
            <label htmlFor="periodo-de">De</label>
            <input id="periodo-de" type="date" value={inicio} onChange={(e) => e.target.value && irPara(e.target.value, e.target.value > fim ? somarDias(e.target.value, dias - 1) : fim)} />
            <label htmlFor="periodo-ate">até</label>
            <input id="periodo-ate" type="date" value={fim} min={inicio} max={somarDias(inicio, 365)} onChange={(e) => e.target.value && irPara(inicio, e.target.value)} />
          </div>
          <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => irPara(somarDias(inicio, -dias))} aria-label={`${dias} dias anteriores`}>
            ←
          </button>
          {(inicio !== hoje || dias !== DIAS) && (
            <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setParams({})}>
              Hoje
            </button>
          )}
          <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => irPara(somarDias(inicio, dias))} aria-label={`Próximos ${dias} dias`}>
            →
          </button>
        </div>
      </div>

      {saidas.dados && saidas.dados.length > 0 && <ResumoPeriodo r={resumirPeriodo(saidas.dados, (s) => porId.get(s.passeioId)?.minimoConfirmacao ?? 12)} />}

      {daPraca.length > 1 && (
        <div className="filtros">
          {daPraca.length > 1 && (
            <div className="campo campo--linha">
              <label htmlFor="filtro-passeio">Passeio</label>
              <select id="filtro-passeio" value={filtroPasseio} onChange={(e) => escolherPasseio(e.target.value)}>
                <option value="">Todos os passeios</option>
                <OpcoesPasseio grupos={grupos} />
              </select>
            </div>
          )}
        </div>
      )}

      {erroCriar && <Aviso tipo="erro">{erroCriar}</Aviso>}
      {novaAberta && passeioCriar && (
        <Modal aberto titulo="Nova saída" aoFechar={() => setNovaAberta(false)}>
          <p className="texto-fraco">Só para casos fora das vendas (ex.: fretamento ou saída extra). Saídas com reserva são criadas sozinhas.</p>
          <form
            className="formulario"
            onSubmit={(e) => {
              e.preventDefault();
              if (dataNova) void criarSaida(passeioCriar, dataNova).then(() => setNovaAberta(false));
            }}
          >
            <div className="campo">
              <label htmlFor="nova-saida-passeio">Passeio</label>
              <select id="nova-saida-passeio" value={passeioCriar.id} onChange={(e) => setPasseioNovo(e.target.value)}>
                <OpcoesPasseio grupos={grupos} />
              </select>
            </div>
            <div className="campo">
              <label htmlFor="nova-saida-data">Data</label>
              <input id="nova-saida-data" type="date" min={hoje} value={dataNova} onChange={(e) => setDataNova(e.target.value)} required />
            </div>
            <div className="modal__acoes">
              <button type="button" className="botao botao--secundario" onClick={() => setNovaAberta(false)}>Cancelar</button>
              <button type="submit" className="botao botao--primario" disabled={!dataNova || criando !== null}>{criando ? "Criando…" : "Criar saída"}</button>
            </div>
          </form>
        </Modal>
      )}
      {passeios.erro && <ErroCarga mensagem={passeios.erro} tentarDeNovo={passeios.recarregar} />}
      {passeios.dados && daPraca.length === 0 && (
        <Vazio titulo="Nenhum passeio cadastrado nesta praça.">
          {pode("produtos:gerenciar") ? "Cadastre um passeio em “Passeios” para criar saídas." : "Peça ao administrador para cadastrar os passeios desta praça."}
        </Vazio>
      )}

      {saidas.carregando && !saidas.dados ? (
        <Carregando texto="Carregando saídas…" />
      ) : saidas.erro ? (
        <ErroCarga mensagem={saidas.erro} tentarDeNovo={saidas.recarregar} />
      ) : daPraca.length === 0 && saidas.dados?.length === 0 ? null : (
        <>
          {saidas.dados?.length === 0 && (
            <Vazio titulo="Nenhuma saída cadastrada neste período.">
              As saídas aparecem sozinhas quando entra uma reserva (Paytour, Viator, Decolar, Civitatis).{podeCriar ? " Para um caso fora disso, use “Nova saída”." : ""}
            </Vazio>
          )}
          <ul className="lista-saidas" aria-label="Saídas por dia" aria-busy={saidas.carregando}>
            {intervaloDias(inicio, dias).flatMap((data) => {
              const doDia = porData.get(data) ?? [];
              const relativo = rotuloRelativo(data, hoje);
              // Dias sem saída não aparecem (as saídas nascem das reservas; pedido do dono, 04/11).
              if (doDia.length === 0) return [];
              return doDia.map((s) => {
                const minimo = porId.get(s.passeioId)?.minimoConfirmacao ?? 12;
                const abaixoMinimo = s.pagantes < minimo && s.status !== "CANCELADA";
                const ocupacao = Math.min(100, Math.round((s.assentos / Math.max(1, s.capacidade)) * 100));
                return (
                  <li key={s.id} className={`saida saida--${s.status.toLowerCase()}`}>
                    <BlocoDia data={data} hoje={hoje} />
                    <div className="saida__principal">
                      <div className="saida__etiquetas">
                        {relativo && <span className="etiqueta etiqueta--hoje">{relativo}</span>}
                        <span className={`etiqueta etiqueta--status-${s.status.toLowerCase()}`}>{ROTULO_STATUS_SAIDA[s.status]}</span>
                        <EtiquetaLinha linha={s.linha} />
                      </div>
                      <span className="saida__passeio">
                        {s.passeio}
                        {mostrarPraca && <span className="texto-fraco"> · {siglaPraca(s.unidadeId)}</span>}
                      </span>
                      <Link to={`/saidas/${s.id}${novaReserva ? "/reservas?nova=1" : ""}`} className="saida__link">
                        {formatarDataExtenso(data)}
                      </Link>
                      <div className="saida__equipe">
                        <span className={s.veiculo ? undefined : "texto-fraco"}>
                          <Icone nome="onibus" tamanho={16} /> {s.veiculo ? `Veículo: ${s.veiculo}` : "Veículo a definir"}
                        </span>
                        <span className={s.guia ? undefined : "texto-fraco"}>
                          <Icone nome="cracha" tamanho={16} /> {s.guia ? `Guia: ${s.guia}` : "Guia a definir"}
                        </span>
                        {s.motorista && (
                          <span>
                            <Icone nome="volante" tamanho={16} /> Motorista: {s.motorista}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="saida__ocupacao">
                      <div className="saida__ocupacao-topo">
                        <span className="saida__rotulo">Ocupação</span>
                        <span className="saida__percentual">{ocupacao}%</span>
                      </div>
                      <span className={`barra-ocupacao${ocupacao >= 90 ? " barra-ocupacao--cheia" : ""}`} aria-hidden="true">
                        <span style={{ width: `${ocupacao}%` }} />
                      </span>
                      <dl className="saida__numeros">
                        <div>
                          <dt>Passageiros</dt>
                          <dd>{s.passageiros}</dd>
                        </div>
                        <div>
                          <dt>Reservas</dt>
                          <dd>{s.reservas}</dd>
                        </div>
                        <div>
                          <dt>Assentos</dt>
                          <dd>
                            {s.assentos}/{s.capacidade}
                          </dd>
                        </div>
                      </dl>
                      <div className={abaixoMinimo ? "saida__pagantes saida__pagantes--abaixo" : "saida__pagantes saida__pagantes--ok"}>
                        <Icone nome={abaixoMinimo ? "alerta" : "check"} tamanho={16} />
                        <span>
                          <strong>{s.pagantes}</strong> {s.pagantes === 1 ? "pagante" : "pagantes"} (mín. {minimo})
                          <span className="saida__selo">{abaixoMinimo ? ` · faltam ${minimo - s.pagantes}` : " · mínimo atingido"}</span>
                        </span>
                      </div>
                    </div>
                    <Link to={`/saidas/${s.id}${novaReserva ? "/reservas?nova=1" : ""}`} className="botao botao--secundario botao--pequeno saida__acao" aria-label={`Abrir lista de passageiros de ${formatarData(data)} — ${s.passeio}`}>
                      Lista de passageiros →
                    </Link>
                  </li>
                );
              });
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function ResumoPeriodo({ r }: { r: ReturnType<typeof resumirPeriodo> }) {
  return (
    <Indicadores rotulo="Resumo do período">
      <Indicador tinta="azul" icone="calendario" rotulo="Saídas no período" valor={r.saidas} detalhe={plural(r.confirmadas, "confirmada")} />
      <Indicador tinta="rosa" icone="pessoas" rotulo="Passageiros" valor={r.passageiros} detalhe={plural(r.reservas, "reserva")} />
      <Indicador tinta="violeta" icone="grafico" rotulo="Ocupação média" valor={`${r.ocupacao}%`} detalhe="dos assentos" />
      {r.abaixoMinimo > 0 ? (
        <Indicador tinta="ambar" icone="alerta" rotulo="Abaixo do mínimo" valor={r.abaixoMinimo} detalhe={`${r.abaixoMinimo === 1 ? "saída precisa" : "saídas precisam"} de atenção`} />
      ) : (
        <Indicador tinta="verde" icone="check" rotulo="Mínimo de pagantes" valor="OK" detalhe="todas as saídas atingiram" />
      )}
    </Indicadores>
  );
}
