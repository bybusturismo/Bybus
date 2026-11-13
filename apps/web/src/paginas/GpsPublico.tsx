import { useEffect, useMemo, useState } from "react";
import { ErroApi, mensagemDeErro, requisitar } from "../api/cliente";
import { MapaRastreio } from "../componentes/MapaRastreio";
import logoVertical from "../marca/bybus-vertical.png";
import { ATUALIZAR_PUBLICO_MS } from "./RastreioPublico";

interface InfoGps {
  veiculo: string;
  placa: string;
  emServico: boolean;
  situacao: "FORA_DE_SERVICO" | "AGUARDANDO_SINAL" | "TRANSMITINDO" | "SEM_SINAL" | "NAO_INICIADO" | "ENCERRADO";
  minutosSemSinal: number | null;
  passeio: string | null;
  etapa: string | null;
  posicao: { lat: number; lng: number; em: string; velocidadeKmh: number | null } | null;
  trajeto: Array<{ lat: number; lng: number }>;
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

export function mensagemGps(i: InfoGps): { texto: string; tom: "info" | "ok" | "alerta" } {
  if (!i.emServico) return { texto: "O veículo não está em serviço agora. Quando o motorista ligar o rastreio, a posição aparece aqui.", tom: "info" };
  if (i.situacao === "SEM_SINAL") return { texto: `Sem sinal há ${i.minutosSemSinal ?? "alguns"} min. Mostramos a última posição.`, tom: "alerta" };
  if (!i.posicao) return { texto: "Rastreio ligado. Aguardando o primeiro sinal do GPS…", tom: "info" };
  return { texto: `Em serviço${i.etapa ? ` · ${i.etapa}` : ""}${i.passeio ? ` · ${i.passeio}` : ""}`, tom: "ok" };
}

/** Link de GPS de um veículo (sem login): posição atual no mapa, atualizada a cada 20 s. Sem dados de passageiros. */
export function GpsPublico({ token }: { token: string }) {
  const [info, setInfo] = useState<InfoGps | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [falha, setFalha] = useState(false);
  useEffect(() => {
    let ativo = true;
    let id: ReturnType<typeof setInterval> | null = null;
    const carregar = async () => {
      try {
        const r = await requisitar<InfoGps>(`/api/publico/gps/${encodeURIComponent(token)}`, { semAvisoSessao: true });
        if (!ativo) return;
        setInfo(r); setErro(null); setFalha(false);
      } catch (e) {
        if (!ativo) return;
        if (e instanceof ErroApi && e.status >= 400 && e.status < 500 && e.status !== 429) {
          setErro(mensagemDeErro(e));
          if (id) clearInterval(id);
        } else setFalha(true);
      }
    };
    void carregar();
    id = setInterval(() => { if (document.visibilityState !== "hidden") void carregar(); }, ATUALIZAR_PUBLICO_MS);
    return () => { ativo = false; if (id) clearInterval(id); };
  }, [token]);
  const trajeto = useMemo(() => (info?.trajeto ?? []).map((p) => [p.lat, p.lng] as [number, number]), [info]);
  const m = info ? mensagemGps(info) : null;
  return (
    <div className="tela-acesso">
      <main className="cartao-acesso cartao-acesso--largo rastreio-publico" id="conteudo">
        <div className="cartao-acesso__marca cartao-acesso__marca--centro">
          <img className="cartao-acesso__logo" src={logoVertical} alt="By Bus Turismo" width={66} height={96} />
          <h1>{info ? `${info.veiculo} · ${info.placa}` : "Localização do veículo"}</h1>
        </div>
        {erro && <div className="aviso aviso--erro" role="alert">{erro}</div>}
        {!info && !erro && <p className="texto-fraco">Carregando…</p>}
        {info && m && (
          <>
            <div className={`rastreio-publico__situacao${m.tom === "ok" ? " rastreio-publico__situacao--ok" : m.tom === "alerta" ? " rastreio-publico__situacao--alerta" : ""}`} role="status" aria-live="polite">
              {m.texto}
            </div>
            {info.posicao && (
              <>
                <p>Última posição às <strong>{hora(info.posicao.em)}</strong>{info.posicao.velocidadeKmh != null ? ` · ${info.posicao.velocidadeKmh} km/h` : ""}</p>
                <MapaRastreio rotulo={`Mapa com a posição de ${info.veiculo}`} onibus={info.posicao} trajeto={trajeto} altura="24rem" />
              </>
            )}
            {falha && <p className="rastreio-publico__nota">Sem conexão no momento. Mostrando a última informação; tentamos de novo em instantes.</p>}
            <p className="rastreio-publico__nota">A página atualiza sozinha a cada 20 segundos. A linha mostra o caminho dos últimos 30 minutos.</p>
          </>
        )}
      </main>
    </div>
  );
}
