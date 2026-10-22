import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, mensagemDeErro, qs } from "../api/cliente";
import type { Passeio, SaidaResumo } from "../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Icone } from "../componentes/Icone";
import { useNotificar } from "../componentes/Notificacoes";
import { useSessao } from "../sessao/Sessao";
import { diferencaDias, formatarData, formatarDataExtenso, hojeIso, intervaloDias, somarDias } from "../util/formato";
import { ROTULO_STATUS_SAIDA } from "../util/rotulos";
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

export function Saidas() {
  const { pode } = useSessao();
  const notificar = useNotificar();
  const navegar = useNavigate();
  const [params, setParams] = useSearchParams();
  const hoje = hojeIso();
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(params.get("de") ?? "") ? params.get("de")! : hoje;
  const fim = somarDias(inicio, DIAS - 1);
  const [passeioId, setPasseioId] = useState<string>(lerPasseioSalvo);
  const [criando, setCriando] = useState<string | null>(null);
  const [erroCriar, setErroCriar] = useState<string | null>(null);
  const [dataNova, setDataNova] = useState("");

  const passeios = useCarregar((s) => api.get<Passeio[]>("/api/passeios", s), []);
  const passeioAtual = passeios.dados?.find((p) => p.id === passeioId) ?? passeios.dados?.[0] ?? null;

  const saidas = useCarregar(
    (s) => api.get<SaidaResumo[]>(`/api/saidas${qs({ de: inicio, ate: fim, passeioId: passeioAtual?.id })}`, s),
    [inicio, fim, passeioAtual?.id],
  );

  function escolherPasseio(id: string) {
    setPasseioId(id);
    try {
      localStorage.setItem(CHAVE_PASSEIO, id);
    } catch {
      /* sem armazenamento: filtro vale só nesta visita */
    }
  }

  async function criarSaida(data: string) {
    if (!passeioAtual) return;
    setCriando(data);
    setErroCriar(null);
    try {
      const s = await api.post<{ id: string }>("/api/saidas", { passeioId: passeioAtual.id, data });
      notificar(`Saída de ${formatarData(data)} criada.`);
      if (data >= inicio && data <= fim) await saidas.recarregar();
      else navegar(`/saidas/${s.id}`);
    } catch (e) {
      setErroCriar(mensagemDeErro(e));
    } finally {
      setCriando(null);
    }
  }

  const minimo = passeioAtual?.minimoConfirmacao ?? 12;
  const porData = new Map((saidas.dados ?? []).map((s) => [s.data, s]));
  const podeCriar = pode("saidas:gerenciar");

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Saídas</h1>
          <p className="pagina__descricao">
            {passeioAtual?.nome ?? "City Tour Toda Ilha"} · {formatarData(inicio)} a {formatarData(fim)}
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

      <div className="filtros">
        {passeios.dados && passeios.dados.length > 1 && (
          <div className="campo campo--linha">
            <label htmlFor="filtro-passeio">Passeio</label>
            <select id="filtro-passeio" value={passeioAtual?.id ?? ""} onChange={(e) => escolherPasseio(e.target.value)}>
              {passeios.dados.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        {podeCriar && passeioAtual && (
          <form
            className="campo campo--linha"
            onSubmit={(e) => {
              e.preventDefault();
              if (dataNova) void criarSaida(dataNova);
            }}
          >
            <label htmlFor="nova-saida-data">Criar saída em</label>
            <input id="nova-saida-data" type="date" min={hoje} value={dataNova} onChange={(e) => setDataNova(e.target.value)} />
            <button type="submit" className="botao botao--primario" disabled={!dataNova || criando !== null}>
              <Icone nome="mais" /> Criar saída
            </button>
          </form>
        )}
      </div>

      {erroCriar && <Aviso tipo="erro">{erroCriar}</Aviso>}
      {passeios.erro && <ErroCarga mensagem={passeios.erro} tentarDeNovo={passeios.recarregar} />}

      {saidas.carregando && !saidas.dados ? (
        <Carregando texto="Carregando saídas…" />
      ) : saidas.erro ? (
        <ErroCarga mensagem={saidas.erro} tentarDeNovo={saidas.recarregar} />
      ) : (
        <>
          {saidas.dados?.length === 0 && (
            <Vazio titulo="Nenhuma saída cadastrada neste período.">
              {podeCriar ? "Crie uma saída pelo botão do dia ou pelo campo “Criar saída em”." : "Quando o atendimento cadastrar saídas, elas aparecerão aqui."}
            </Vazio>
          )}
          <ul className="lista-saidas" aria-label="Saídas por dia" aria-busy={saidas.carregando}>
            {intervaloDias(inicio, DIAS).map((data) => {
              const s = porData.get(data);
              const relativo = rotuloRelativo(data, hoje);
              if (!s) {
                return (
                  <li key={data} className="saida saida--vazia">
                    <div className="saida__data">
                      {relativo && <span className="etiqueta etiqueta--neutra">{relativo}</span>}
                      <span>{formatarDataExtenso(data)}</span>
                    </div>
                    <span className="saida__sem">Sem saída</span>
                    {podeCriar && passeioAtual && (
                      <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void criarSaida(data)} disabled={criando !== null}>
                        {criando === data ? "Criando…" : "Criar saída"}
                      </button>
                    )}
                  </li>
                );
              }
              const abaixoMinimo = s.pagantes < minimo && s.status !== "CANCELADA";
              const ocupacao = Math.min(100, Math.round((s.assentos / Math.max(1, s.capacidade)) * 100));
              return (
                <li key={data} className={`saida saida--${s.status.toLowerCase()}`}>
                  <div className="saida__data">
                    {relativo && <span className="etiqueta etiqueta--neutra">{relativo}</span>}
                    <Link to={`/saidas/${s.id}`} className="saida__link">
                      {formatarDataExtenso(data)}
                    </Link>
                    <span className={`etiqueta etiqueta--status-${s.status.toLowerCase()}`}>{ROTULO_STATUS_SAIDA[s.status]}</span>
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
                    {s.guia && <span>Guia: {s.guia}</span>}
                  </div>
                  <Link to={`/saidas/${s.id}`} className="botao botao--secundario botao--pequeno" aria-label={`Abrir lista de passageiros de ${formatarData(data)}`}>
                    Lista de passageiros
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
