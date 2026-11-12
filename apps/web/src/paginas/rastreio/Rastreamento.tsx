import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { MapaRastreio } from "../../componentes/MapaRastreio";
import { Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { formatarDataExtenso, hojeIso } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { RastreioPublico } from "../RastreioPublico";

type Situacao = "NAO_INICIADO" | "AGUARDANDO_SINAL" | "TRANSMITINDO" | "SEM_SINAL" | "ENCERRADO";

interface SaidaRastreio {
  saidaId: string;
  passeio: string;
  data: string;
  motorista: string | null;
  veiculo: string | null;
  situacao: Situacao;
  minutosSemSinal: number | null;
  /** Van do transfer (11/11/2026), à parte do ônibus. */
  van?: { situacao: Situacao; minutosSemSinal: number | null; ultimaPosicao: { em: string } | null } | null;
  sessao: { id: string; iniciadaEm: string; encerradaEm: string | null } | null;
  ultimaPosicao: { lat: number; lng: number; em: string } | null;
  pontos: { total: number; comCoordenadas: number };
}
interface Detalhe extends Omit<SaidaRastreio, "pontos" | "ultimaPosicao"> {
  ultimaPosicao: { lat: number; lng: number; em: string } | null;
  pontos: Array<{ id: string; nome: string; horario: string; lat: number | null; lng: number | null; passou: boolean; passouEm?: string | null; pulou?: boolean }>;
  trajeto: Array<{ lat: number; lng: number; em: string }>;
  resumo?: { inicio: string | null; fim: string | null; duracaoMin: number; km: number; velocidadeMediaKmh: number | null; velocidadeMaximaKmh: number | null };
}

/** Diferença em minutos entre o horário previsto ("HH:MM") e o real (Brasília). */
function atraso(previsto: string, real: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(previsto);
  if (!m) return null;
  const [h, min] = new Date(real).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).split(":").map(Number) as [number, number];
  return h * 60 + min - (Number(m[1]) * 60 + Number(m[2]));
}

const ATUALIZAR_MS = 15_000;
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

export function RotuloSituacao({ situacao, minutos }: { situacao: Situacao; minutos: number | null }) {
  const [texto, classe] =
    situacao === "TRANSMITINDO" ? ["Transmitindo", "etiqueta--sucesso"]
    : situacao === "SEM_SINAL" ? [`Sem sinal há ${minutos ?? "?"} min`, "etiqueta--atencao"]
    : situacao === "AGUARDANDO_SINAL" ? ["Aguardando o 1º sinal", "etiqueta--atencao"]
    : situacao === "ENCERRADO" ? ["Encerrado", "etiqueta--neutra"]
    : ["Não iniciado", "etiqueta--neutra"];
  return <span className={`etiqueta ${classe}`}>{texto}</span>;
}

/** Acompanhamento da equipe: saídas do dia, situação do sinal e mapa. */
export function Rastreamento() {
  const { pode } = useSessao();
  const notificar = useNotificar();
  const [data, setData] = useState(hojeIso());
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [cliente, setCliente] = useState(false);
  const [tipo, setTipo] = useState<"ONIBUS" | "TRANSFER">("ONIBUS");
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const lista = useCarregar((s) => api.get<SaidaRastreio[]>(`/api/rastreio/saidas?data=${data}`, s), [data]);
  const alvo = escolhida ?? lista.dados?.[0]?.saidaId ?? null;
  const detalhe = useCarregar((s) => (alvo ? api.get<Detalhe>(`/api/rastreio/saidas/${alvo}?tipo=${tipo}`, s) : Promise.resolve(null)), [alvo, tipo]);

  // Atualiza sozinho enquanto a tela está visível.
  const { recarregar: recarregarLista } = lista;
  const { recarregar: recarregarDetalhe } = detalhe;
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void recarregarLista();
      void recarregarDetalhe();
    }, ATUALIZAR_MS);
    return () => clearInterval(id);
  }, [recarregarLista, recarregarDetalhe]);

  const d = detalhe.dados;
  const pontosMapa = useMemo(() => (d?.pontos ?? []).filter((p) => p.lat !== null && p.lng !== null).map((p) => ({ lat: p.lat!, lng: p.lng!, nome: p.nome, passou: p.passou })), [d]);
  const trajeto = useMemo(() => (d?.trajeto ?? []).map((t) => [t.lat, t.lng] as [number, number]), [d]);
  const onibus = d?.ultimaPosicao && d.situacao !== "ENCERRADO" ? { lat: d.ultimaPosicao.lat, lng: d.ultimaPosicao.lng } : null;
  const semCoordenadas = d ? d.pontos.filter((p) => p.lat === null).length : 0;

  async function encerrar() {
    if (!d?.sessao) return;
    setErroAcao(null);
    try {
      await api.post(`/api/rastreio/sessoes/${d.sessao.id}/encerrar`, {});
      notificar("Rastreio encerrado.");
      await Promise.all([lista.recarregar(), detalhe.recarregar()]);
    } catch (e) {
      setErroAcao(mensagemDeErro(e));
    }
  }

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Rastreamento</h1>
          <p className="pagina__descricao">Onde está o ônibus de cada saída, vindo do celular do motorista. Atualiza sozinho a cada 15 segundos.</p>
        </div>
      </div>
      <div className="filtros" role="search" aria-label="Escolher o dia">
        <div className="campo">
          <label htmlFor="rs-data">Dia</label>
          <input id="rs-data" type="date" value={data} onChange={(e) => { setData(e.target.value || hojeIso()); setEscolhida(null); }} />
        </div>
        <div className="campo">
          <label htmlFor="rs-tipo">Veículo</label>
          <select id="rs-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as "ONIBUS" | "TRANSFER")}>
            <option value="ONIBUS">Ônibus (pontos de embarque)</option>
            <option value="TRANSFER">Van do transfer (hotéis)</option>
          </select>
        </div>
      </div>

      {lista.carregando && !lista.dados ? (
        <Carregando />
      ) : lista.erro ? (
        <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} />
      ) : !lista.dados?.length ? (
        <Vazio titulo={`Nenhuma saída em ${formatarDataExtenso(data)}.`} />
      ) : (
        <>
          <ul className="rastreio-lista" aria-label="Saídas do dia">
            {lista.dados.map((s) => (
              <li key={s.saidaId}>
                <button type="button" aria-pressed={s.saidaId === alvo} onClick={() => setEscolhida(s.saidaId)}>
                  <strong>{s.passeio}</strong>
                  <span className="texto-fraco">Motorista: {s.motorista ?? "a definir"}{s.veiculo ? ` · ${s.veiculo}` : ""}</span>
                  <span>
                    <RotuloSituacao situacao={s.situacao} minutos={s.minutosSemSinal} />
                    {s.ultimaPosicao && s.situacao !== "ENCERRADO" ? <span className="texto-fraco"> · última posição às {hora(s.ultimaPosicao.em)}</span> : null}
                    {s.van && <span className="texto-fraco"> · Van do transfer: <RotuloSituacao situacao={s.van.situacao} minutos={s.van.minutosSemSinal} /></span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {detalhe.erro ? (
            <ErroCarga mensagem={detalhe.erro} tentarDeNovo={detalhe.recarregar} />
          ) : d ? (
            <section aria-label={`Mapa de ${d.passeio}`} className="rastreio-detalhe">
              <div>
                {d.situacao === "NAO_INICIADO" && <Aviso tipo="info">O motorista ainda não iniciou o rastreio desta saída.</Aviso>}
                {d.situacao === "SEM_SINAL" && <Aviso tipo="atencao">Sem sinal do celular do motorista há {d.minutosSemSinal} min. A tela pode ter apagado, o app ter sido trocado ou o celular estar sem internet.</Aviso>}
                {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
                <MapaRastreio rotulo={`Mapa do ônibus de ${d.passeio}`} onibus={onibus} pontos={pontosMapa} trajeto={trajeto} />
                <p className="texto-fraco">
                  {onibus && d.ultimaPosicao ? `Última posição às ${hora(d.ultimaPosicao.em)}.` : "Sem posição para mostrar."}{" "}
                  {d.sessao && !d.sessao.encerradaEm ? `Rastreio iniciado às ${hora(d.sessao.iniciadaEm)}.` : ""}
                </p>
              </div>
              <div className="cartao">
                <h2>Rota</h2>
                {semCoordenadas > 0 && (
                  <Aviso tipo="atencao">
                    {semCoordenadas} de {d.pontos.length} ponto(s) sem coordenadas: sem elas não aparecem no mapa e não há previsão de chegada.{" "}
                    {pode("produtos:gerenciar") ? <Link to="/passeios">Cadastrar em Passeios e pontos</Link> : "Peça a quem gerencia os passeios para cadastrar."}
                  </Aviso>
                )}
                {d.resumo?.inicio && (
                  <p className="texto-fraco">
                    Trajeto de {hora(d.resumo.inicio)} a {hora(d.resumo.fim!)} · {d.resumo.duracaoMin} min · {d.resumo.km.toLocaleString("pt-BR")} km
                    {d.resumo.velocidadeMediaKmh !== null ? ` · média ${d.resumo.velocidadeMediaKmh} km/h` : ""}
                    {d.resumo.velocidadeMaximaKmh !== null ? ` · máxima ${d.resumo.velocidadeMaximaKmh} km/h` : ""}
                  </p>
                )}
                <div className="tabela-rolagem">
                  <table className="tabela tabela--compacta rastreio-historico">
                    <thead><tr><th scope="col">Previsto</th><th scope="col">{tipo === "TRANSFER" ? "Hotel" : "Ponto"}</th><th scope="col">Passou</th><th scope="col">Diferença</th></tr></thead>
                    <tbody>
                      {d.pontos.map((p) => {
                        const dif = p.passouEm ? atraso(p.horario, p.passouEm) : null;
                        return (
                          <tr key={p.id} className={p.pulou ? "linha--atencao" : undefined}>
                            <td className="sem-quebra">{p.horario || "—"}</td>
                            <td>{p.nome}{p.lat === null ? <span className="texto-fraco"> (sem coordenadas)</span> : ""}</td>
                            <td className="sem-quebra">{p.passouEm ? hora(p.passouEm) : p.pulou ? <span className="etiqueta etiqueta--perigo">Pulou</span> : <span className="texto-fraco">—</span>}</td>
                            <td className="sem-quebra">{dif === null ? "" : dif === 0 ? "no horário" : dif > 0 ? <span className="texto-atencao">{dif} min atrasado</span> : `${-dif} min adiantado`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="modal__acoes">
                  {import.meta.env.VITE_DEMO === "1" && (
                    <button type="button" className="botao botao--secundario" onClick={() => setCliente(true)}>
                      Ver como o cliente vê
                    </button>
                  )}
                  {pode("saidas:decidir") && d.sessao && !d.sessao.encerradaEm && (
                    <button type="button" className="botao botao--perigo-contorno" onClick={() => void encerrar()}>
                      Encerrar rastreio
                    </button>
                  )}
                </div>
              </div>
            </section>
          ) : null}
        </>
      )}
      {import.meta.env.VITE_DEMO === "1" && (
        <Modal aberto={cliente} titulo="Página do cliente (demonstração)" aoFechar={() => setCliente(false)} largura="larga">
          {cliente && <RastreioPublico token="demonstracao-rastreio-ficticio-0000" incorporado />}
        </Modal>
      )}
    </div>
  );
}
