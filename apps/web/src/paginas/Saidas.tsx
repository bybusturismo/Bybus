import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, mensagemDeErro, qs } from "../api/cliente";
import type { Passeio, SaidaResumo, UnidadeResumo } from "../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Icone } from "../componentes/Icone";
import { useNotificar } from "../componentes/Notificacoes";
import { nomePraca, useSessao } from "../sessao/Sessao";
import { diferencaDias, formatarData, formatarDataExtenso, hojeIso, intervaloDias, somarDias } from "../util/formato";
import { ROTULO_STATUS_SAIDA } from "../util/rotulos";
import { EtiquetaLinha } from "../componentes/Etiquetas";
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
  const hoje = hojeIso();
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(params.get("de") ?? "") ? params.get("de")! : hoje;
  const fim = somarDias(inicio, DIAS - 1);
  const [passeioSalvo, setPasseioSalvo] = useState<string>(lerPasseioSalvo);
  const [criando, setCriando] = useState<string | null>(null);
  const [erroCriar, setErroCriar] = useState<string | null>(null);
  const [dataNova, setDataNova] = useState("");
  const [passeioNovo, setPasseioNovo] = useState("");

  const passeios = useCarregar((s) => api.get<Passeio[]>("/api/passeios", s), []);
  const daPraca = (passeios.dados ?? []).filter((p) => !praca || p.unidadeId === praca);
  const filtroPasseio = daPraca.some((p) => p.id === passeioSalvo) ? passeioSalvo : "";
  const porId = new Map((passeios.dados ?? []).map((p) => [p.id, p]));
  /** Passeio usado nos botões "Criar saída" de cada dia: o filtrado, ou o único da praça. */
  const passeioDoDia = filtroPasseio ? porId.get(filtroPasseio)! : daPraca.length === 1 ? daPraca[0]! : null;
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
          <button type="button" className="botao botao--secundario" onClick={() => setParams({ de: somarDias(inicio, -DIAS) })}>
            ← 14 dias anteriores
          </button>
          {inicio !== hoje && (
            <button type="button" className="botao botao--secundario" onClick={() => setParams({})}>
              Hoje
            </button>
          )}
          <button type="button" className="botao botao--secundario" onClick={() => setParams({ de: somarDias(inicio, DIAS) })}>
            Próximos 14 dias →
          </button>
        </div>
      </div>

      {(daPraca.length > 1 || (podeCriar && passeioCriar)) && (
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
          {podeCriar && passeioCriar && (
            <form
              className="campo campo--linha"
              aria-label="Criar saída"
              onSubmit={(e) => {
                e.preventDefault();
                if (dataNova) void criarSaida(passeioCriar, dataNova);
              }}
            >
              {daPraca.length > 1 && (
                <>
                  <label htmlFor="nova-saida-passeio">Nova saída de</label>
                  <select id="nova-saida-passeio" value={passeioCriar.id} onChange={(e) => setPasseioNovo(e.target.value)}>
                    <OpcoesPasseio grupos={grupos} />
                  </select>
                </>
              )}
              <label htmlFor="nova-saida-data">{daPraca.length > 1 ? "em" : "Criar saída em"}</label>
              <input id="nova-saida-data" type="date" min={hoje} value={dataNova} onChange={(e) => setDataNova(e.target.value)} />
              <button type="submit" className="botao botao--primario" disabled={!dataNova || criando !== null}>
                <Icone nome="mais" /> Criar saída
              </button>
            </form>
          )}
        </div>
      )}

      {erroCriar && <Aviso tipo="erro">{erroCriar}</Aviso>}
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
              {podeCriar ? "Crie uma saída pelo botão do dia ou pelo campo “Criar saída em”." : "Quando o atendimento cadastrar saídas, elas aparecerão aqui."}
            </Vazio>
          )}
          <ul className="lista-saidas" aria-label="Saídas por dia" aria-busy={saidas.carregando}>
            {intervaloDias(inicio, DIAS).flatMap((data) => {
              const doDia = porData.get(data) ?? [];
              const relativo = rotuloRelativo(data, hoje);
              if (doDia.length === 0) {
                return [
                  <li key={data} className="saida saida--vazia">
                    <div className="saida__data">
                      {relativo && <span className="etiqueta etiqueta--neutra">{relativo}</span>}
                      <span>{formatarDataExtenso(data)}</span>
                    </div>
                    <span className="saida__sem">Sem saída</span>
                    {podeCriar && passeioDoDia && (
                      <button
                        type="button"
                        className="botao botao--secundario botao--pequeno"
                        onClick={() => void criarSaida(passeioDoDia, data)}
                        disabled={criando !== null}
                        aria-label={`Criar saída de ${passeioDoDia.nome} em ${formatarData(data)}`}
                      >
                        {criando === data ? "Criando…" : "Criar saída"}
                      </button>
                    )}
                  </li>,
                ];
              }
              return doDia.map((s) => {
                const minimo = porId.get(s.passeioId)?.minimoConfirmacao ?? 12;
                const abaixoMinimo = s.pagantes < minimo && s.status !== "CANCELADA";
                const ocupacao = Math.min(100, Math.round((s.assentos / Math.max(1, s.capacidade)) * 100));
                return (
                  <li key={s.id} className={`saida saida--${s.status.toLowerCase()}`}>
                    <div className="saida__data">
                      {relativo && <span className="etiqueta etiqueta--neutra">{relativo}</span>}
                      <Link to={`/saidas/${s.id}`} className="saida__link">
                        {formatarDataExtenso(data)}
                      </Link>
                      <span className={`etiqueta etiqueta--status-${s.status.toLowerCase()}`}>{ROTULO_STATUS_SAIDA[s.status]}</span>
                      <span className="saida__passeio">
                        {s.passeio}
                        {mostrarPraca && <span className="texto-fraco"> · {siglaPraca(s.unidadeId)}</span>}
                      </span>
                      <EtiquetaLinha linha={s.linha} />
                    </div>
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
                          <span className="barra-ocupacao" aria-hidden="true">
                            <span style={{ width: `${ocupacao}%` }} />
                          </span>
                        </dd>
                      </div>
                      <div className={abaixoMinimo ? "saida__pagantes saida__pagantes--abaixo" : "saida__pagantes saida__pagantes--ok"}>
                        <dt>Pagantes (mín. {minimo})</dt>
                        <dd>
                          {s.pagantes}
                          <span className="saida__selo">{abaixoMinimo ? ` faltam ${minimo - s.pagantes}` : " mínimo atingido"}</span>
                        </dd>
                      </div>
                    </dl>
                    <div className="saida__equipe">
                      {s.veiculo ? <span>Veículo: {s.veiculo}</span> : <span className="texto-fraco">Veículo a definir</span>}
                      {s.guia ? <span>Guia: {s.guia}</span> : <span className="texto-fraco">Guia a definir</span>}
                      {s.motorista && <span>Motorista: {s.motorista}</span>}
                    </div>
                    <Link to={`/saidas/${s.id}`} className="botao botao--secundario botao--pequeno" aria-label={`Abrir lista de passageiros de ${formatarData(data)} — ${s.passeio}`}>
                      Lista de passageiros
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
