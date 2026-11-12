import { useEffect, useMemo, useState } from "react";
import { ErroApi, mensagemDeErro, requisitar } from "../api/cliente";
import { MapaRastreio } from "../componentes/MapaRastreio";
import logoVertical from "../marca/bybus-vertical.png";
import { formatarDataExtenso } from "../util/formato";

export const ATUALIZAR_PUBLICO_MS = 20_000;

type Situacao = "NAO_INICIADO" | "AGUARDANDO_SINAL" | "TRANSMITINDO" | "SEM_SINAL" | "ENCERRADO";
interface InfoRastreio {
  passeio: string;
  cidade: string;
  data: string;
  situacao: Situacao;
  minutosSemSinal: number | null;
  ponto: { nome: string; horario: string; lat?: number; lng?: number } | null;
  onibus: { lat: number; lng: number; em: string } | null;
  rota: Array<{ nome: string; lat: number; lng: number; passou: boolean; doCliente: boolean }>;
  previsao: { situacao: "A_CAMINHO" | "NO_PONTO" | "JA_PASSOU" | "SEM_PREVISAO"; minutos: number | null; motivo: "SEM_PONTO" | "SEM_COORDENADAS" | null; estimativa: boolean } | null;
  jaPassou: boolean;
}

/** Texto principal da página, conforme a situação. */
export function mensagemPrincipal(i: InfoRastreio): { texto: string; minutos?: number; tom: "info" | "ok" | "alerta" } {
  if (i.situacao === "ENCERRADO") return { texto: "O acompanhamento deste passeio foi encerrado.", tom: "info" };
  if (i.situacao === "NAO_INICIADO") return { texto: "O City Tour ainda não saiu. Esta página atualiza sozinha.", tom: "info" };
  if (i.situacao === "AGUARDANDO_SINAL") return { texto: "O City Tour está saindo e ainda não temos a posição. Esta página atualiza sozinha.", tom: "info" };
  const sem = i.situacao === "SEM_SINAL" ? ` Sem sinal do City Tour há ${i.minutosSemSinal ?? "alguns"} min; mostramos a última posição.` : "";
  if (i.jaPassou || i.previsao?.situacao === "JA_PASSOU") return { texto: `O City Tour já passou pelo seu ponto.${sem}`, tom: "alerta" };
  if (i.previsao?.situacao === "NO_PONTO") return { texto: "O City Tour está no seu ponto!", tom: "ok" };
  if (i.previsao?.situacao === "A_CAMINHO" && i.previsao.minutos != null) return { texto: "O City Tour chega ao seu ponto em", minutos: i.previsao.minutos, tom: "ok" };
  if (i.situacao === "SEM_SINAL") return { texto: `Sem sinal do City Tour há ${i.minutosSemSinal ?? "alguns"} min. Mostramos a última posição.`, tom: "alerta" };
  if (!i.ponto) return { texto: "O City Tour está a caminho. Não temos o seu ponto de embarque: fale com a nossa equipe para ver a previsão.", tom: "info" };
  return { texto: "O City Tour está a caminho. A previsão para o seu ponto ainda não está disponível.", tom: "info" };
}

/** Página do link de rastreio (sem login): ônibus no mapa, ponto do cliente e previsão. Atualiza a cada 20 s. */
export function RastreioPublico({ token, incorporado = false }: { token: string; incorporado?: boolean }) {
  const [info, setInfo] = useState<InfoRastreio | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [falhaTemporaria, setFalhaTemporaria] = useState(false);

  useEffect(() => {
    let ativo = true;
    let id: ReturnType<typeof setInterval> | null = null;
    const carregar = async () => {
      try {
        const r = await requisitar<InfoRastreio>(`/api/publico/rastreio/${encodeURIComponent(token)}`, { semAvisoSessao: true });
        if (!ativo) return;
        setInfo(r);
        setErro(null);
        setFalhaTemporaria(false);
      } catch (e) {
        if (!ativo) return;
        // Link inválido ou vencido: não adianta insistir. Outras falhas: mantém o que já está na tela.
        if (e instanceof ErroApi && e.status >= 400 && e.status < 500 && e.status !== 429) {
          setErro(mensagemDeErro(e));
          if (id) clearInterval(id);
        } else setFalhaTemporaria(true);
      }
    };
    void carregar();
    id = setInterval(() => {
      if (document.visibilityState !== "hidden") void carregar();
    }, ATUALIZAR_PUBLICO_MS);
    return () => {
      ativo = false;
      if (id) clearInterval(id);
    };
  }, [token]);

  const pontos = useMemo(
    () => (info?.rota ?? []).map((p) => ({ lat: p.lat, lng: p.lng, nome: p.nome, passou: p.passou, destaque: p.doCliente })),
    [info],
  );
  // O ponto do cliente sempre aparece em destaque, mesmo que ele não esteja na lista de pontos com coordenadas.
  const todosPontos = useMemo(() => {
    const c = info?.ponto;
    if (c?.lat === undefined || c.lng === undefined || pontos.some((p) => p.destaque)) return pontos;
    return [...pontos, { lat: c.lat, lng: c.lng, nome: c.nome, destaque: true }];
  }, [info, pontos]);

  const m = info ? mensagemPrincipal(info) : null;
  const conteudo = (
    <>
      {erro && <div className="aviso aviso--erro" role="alert">{erro}</div>}
      {!info && !erro && <p className="texto-fraco">Carregando…</p>}
      {info && m && (
        <>
          <p className="cartao-acesso__subtitulo">
            <strong>{info.passeio}</strong> — {formatarDataExtenso(info.data)}
          </p>
          <div className={`rastreio-publico__situacao${m.tom === "ok" ? " rastreio-publico__situacao--ok" : m.tom === "alerta" ? " rastreio-publico__situacao--alerta" : ""}`} role="status" aria-live="polite">
            {m.texto}
            {m.minutos !== undefined && <span className="rastreio-publico__minutos">~{m.minutos} min</span>}
          </div>
          {info.ponto && (
            <p>
              Seu ponto de embarque: <strong>{info.ponto.horario} — {info.ponto.nome}</strong>
            </p>
          )}
          {info.ponto && (
            <p className="rastreio-publico__nota">
              <strong>Não há tolerância para atrasos.</strong> Esteja no ponto alguns minutos antes. Se perder o embarque, dirija-se ao próximo ponto de embarque.
            </p>
          )}
          {(info.onibus || todosPontos.length > 0) && <MapaRastreio rotulo="Mapa com o City Tour e o seu ponto de embarque" onibus={info.onibus} pontos={todosPontos} altura="20rem" />}
          {falhaTemporaria && <p className="rastreio-publico__nota">Sem conexão no momento. Mostrando a última informação; tentamos de novo em instantes.</p>}
          <p className="rastreio-publico__nota">
            O horário é uma estimativa e pode mudar com o trânsito. A página atualiza sozinha a cada 20 segundos.
          </p>
        </>
      )}
    </>
  );

  if (incorporado) return <div className="rastreio-publico">{conteudo}</div>;
  return (
    <div className="tela-acesso">
      <main className="cartao-acesso cartao-acesso--largo rastreio-publico" id="conteudo">
        <div className="cartao-acesso__marca cartao-acesso__marca--centro">
          <img className="cartao-acesso__logo" src={logoVertical} alt="By Bus Turismo" width={66} height={96} />
          <h1>Acompanhe o City Tour</h1>
        </div>
        {conteudo}
      </main>
    </div>
  );
}
