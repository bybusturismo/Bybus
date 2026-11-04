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
  sessao: { id: string; iniciadaEm: string; encerradaEm: string | null } | null;
  ultimaPosicao: { lat: number; lng: number; em: string } | null;
  pontos: { total: number; comCoordenadas: number };
}
interface Detalhe extends Omit<SaidaRastreio, "pontos" | "ultimaPosicao"> {
  ultimaPosicao: { lat: number; lng: number; em: string } | null;
  pontos: Array<{ id: string; nome: string; horario: string; lat: number | null; lng: number | null; passou: boolean }>;
  trajeto: Array<{ lat: number; lng: number; em: string }>;
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
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const lista = useCarregar((s) => api.get<SaidaRastreio[]>(`/api/rastreio/saidas?data=${data}`, s), [data]);
  const alvo = escolhida ?? lista.dados?.[0]?.saidaId ?? null;
  const detalhe = useCarregar((s) => (alvo ? api.get<Detalhe>(`/api/rastreio/saidas/${alvo}`, s) : Promise.resolve(null)), [alvo]);

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
                <ol className="rastreio-pontos">
                  {d.pontos.map((p) => (
                    <li key={p.id} className={p.passou ? "passou" : undefined}>
                      {p.horario} — {p.nome}
                      {p.lat === null ? " (sem coordenadas)" : ""}
                    </li>
                  ))}
                </ol>
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
