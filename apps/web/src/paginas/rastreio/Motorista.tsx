import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ErroApi, mensagemDeErro, requisitar } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { useSessao } from "../../sessao/Sessao";
import { formatarDataExtenso } from "../../util/formato";
import { MENSAGEM_ERRO_GPS, observarPosicao, type ErroGps, type PosicaoGps } from "../../util/geolocalizacao";
import { useCarregar } from "../../util/useCarregar";
import { gpsDoApp, noApp, postarPeloApp } from "../../util/appCelular";

export const AVISO_TELA_ABERTA = "Mantenha esta tela aberta e o celular no carregador; se a tela apagar ou outro app abrir, o rastreio para.";
/** No app By Bus o GPS segue em segundo plano (11/11/2026). */
export const AVISO_APP = "Pode apagar a tela ou abrir outros apps: o rastreio continua (aparece o aviso “By Bus — rastreio ligado”). Deixe o celular no carregador e toque em Encerrar ao terminar o passeio.";
const MENSAGEM_GPS_NEGADO_APP = "O app By Bus está sem permissão de localização. Toque em “Abrir configurações”, vá em Permissões › Localização e escolha “Permitir”.";
/** Intervalo entre os envios e tamanho do lote (a API aceita até 20 posições por envio). */
export const INTERVALO_ENVIO_MS = 15_000;
const LOTE = 20;
/** No máximo uma posição a cada 5 s na fila (o GPS pode avisar com mais frequência). */
const INTERVALO_AMOSTRA_MS = 5000;
/** Teto da fila local (sem internet por muito tempo): descarta as mais antigas. */
const FILA_MAXIMA = 2000;

interface SaidaMotorista {
  saidaId: string;
  passeio: string;
  data: string;
  veiculo: string | null;
  sessao: { id: string; iniciadaEm: string } | null;
}

const chaveFila = (sessaoId: string) => `bybus.rastreio.fila.${sessaoId}`;
function lerFila(sessaoId: string): PosicaoGps[] {
  try {
    const v = JSON.parse(localStorage.getItem(chaveFila(sessaoId)) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function gravarFila(sessaoId: string, fila: PosicaoGps[]) {
  try {
    if (fila.length) localStorage.setItem(chaveFila(sessaoId), JSON.stringify(fila));
    else localStorage.removeItem(chaveFila(sessaoId));
  } catch {
    /* sem armazenamento: a fila vale só enquanto a tela estiver aberta */
  }
}

/** Envia um lote de posições: no app pelo HTTP nativo (não fica lento em segundo plano); no navegador pelo fetch. */
async function enviarLote(sessaoId: string, lote: PosicaoGps[]) {
  const url = `/api/rastreio/sessoes/${sessaoId}/posicoes`;
  let r: Awaited<ReturnType<typeof postarPeloApp>>;
  try {
    r = await postarPeloApp(url, { posicoes: lote });
  } catch {
    throw new ErroApi(0, "SEM_CONEXAO", "Sem conexão com o servidor.");
  }
  if (r === null) {
    await requisitar(url, { metodo: "POST", corpo: { posicoes: lote } });
    return;
  }
  if (r.status >= 200 && r.status < 300) return;
  const d = (r.data && typeof r.data === "object" ? r.data : {}) as { codigo?: string; mensagem?: string };
  throw new ErroApi(r.status, d.codigo ?? "ERRO", d.mensagem ?? `Erro ${r.status} ao enviar as posições.`);
}

const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" });

type Fase = "parado" | "iniciando" | "transmitindo" | "encerrando";

/** Transmissão de uma saída: GPS, fila local, envio em lotes, tela acesa e avisos. */
function useTransmissao(aoMudar: () => void) {
  const [fase, setFase] = useState<Fase>("parado");
  const [saidaId, setSaidaId] = useState<string | null>(null);
  const [ultima, setUltima] = useState<Date | null>(null);
  const [naFila, setNaFila] = useState(0);
  const [semInternet, setSemInternet] = useState(false);
  const [erroGps, setErroGps] = useState<ErroGps | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [saiuDaTela, setSaiuDaTela] = useState(false);
  const [telaAcesa, setTelaAcesa] = useState<boolean | null>(null);

  const sessao = useRef<string | null>(null);
  const fila = useRef<PosicaoGps[]>([]);
  const enviando = useRef(false);
  const ultimoEnvio = useRef(0);
  const ultimaAmostra = useRef(0);
  const parar = useRef<() => void>(() => {});
  const temporizador = useRef<ReturnType<typeof setInterval> | null>(null);
  const trava = useRef<{ release: () => Promise<void> } | null>(null);

  const pedirTela = useCallback(async () => {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      if (!wl) return setTelaAcesa(false);
      trava.current = await wl.request("screen");
      setTelaAcesa(true);
    } catch {
      setTelaAcesa(false);
    }
  }, []);

  const pararTudo = useCallback(() => {
    parar.current();
    parar.current = () => {};
    if (temporizador.current) clearInterval(temporizador.current);
    temporizador.current = null;
    void trava.current?.release().catch(() => {});
    trava.current = null;
    setTelaAcesa(null);
    sessao.current = null;
    setFase("parado");
    setSaidaId(null);
  }, []);

  /** Envia a fila em lotes de até 20. Sem internet, mantém tudo e tenta de novo no próximo ciclo. */
  const enviar = useCallback(async () => {
    const id = sessao.current;
    if (!id || enviando.current) return;
    enviando.current = true;
    try {
      while (fila.current.length && sessao.current === id) {
        const lote = fila.current.slice(0, LOTE);
        await enviarLote(id, lote);
        ultimoEnvio.current = Date.now();
        fila.current.splice(0, lote.length);
        gravarFila(id, fila.current);
        setSemInternet(false);
      }
    } catch (e) {
      if (e instanceof ErroApi && e.status === 0) setSemInternet(true);
      else if (e instanceof ErroApi && [403, 409].includes(e.status)) {
        // A sessão não vale mais (encerrada, dia errado): para por aqui.
        setErro(e.message);
        pararTudo();
        aoMudar();
      }
      // 429 e erros do servidor: mantém a fila e tenta no próximo ciclo.
    } finally {
      enviando.current = false;
      setNaFila(fila.current.length);
    }
  }, [aoMudar, pararTudo]);

  const comecar = useCallback(
    (id: string, daSaida: string) => {
      sessao.current = id;
      fila.current = lerFila(id);
      setNaFila(fila.current.length);
      setSaidaId(daSaida);
      setFase("transmitindo");
      setSaiuDaTela(false);
      setErroGps(null);
      void pedirTela();
      parar.current = observarPosicao(
        (p) => {
          setErroGps(null);
          if (Date.now() - ultimaAmostra.current < INTERVALO_AMOSTRA_MS) return;
          ultimaAmostra.current = Date.now();
          fila.current.push(p);
          if (fila.current.length > FILA_MAXIMA) fila.current.splice(0, fila.current.length - FILA_MAXIMA);
          gravarFila(id, fila.current);
          setNaFila(fila.current.length);
          setUltima(new Date(p.registradaEm));
          // No app, com a tela apagada o relógio da página pode parar: cada posição nova também dispara o envio.
          if (noApp() && Date.now() - ultimoEnvio.current >= INTERVALO_ENVIO_MS) void enviar();
        },
        (e) => setErroGps(e),
      );
      temporizador.current = setInterval(() => void enviar(), INTERVALO_ENVIO_MS);
    },
    [enviar, pedirTela],
  );

  const iniciar = useCallback(
    async (s: SaidaMotorista) => {
      setErro(null);
      setFase("iniciando");
      try {
        const r = await requisitar<{ sessaoId: string }>(`/api/rastreio/saidas/${s.saidaId}/iniciar`, { metodo: "POST" });
        comecar(r.sessaoId, s.saidaId);
        aoMudar();
      } catch (e) {
        setErro(mensagemDeErro(e));
        setFase("parado");
      }
    },
    [aoMudar, comecar],
  );

  const encerrar = useCallback(async () => {
    const id = sessao.current;
    if (!id) return;
    setFase("encerrando");
    await enviar(); // o que sobrou na fila vai antes: sessão encerrada não aceita posições
    try {
      await requisitar(`/api/rastreio/sessoes/${id}/encerrar`, { metodo: "POST" });
      fila.current = [];
      gravarFila(id, []);
      pararTudo();
      aoMudar();
    } catch (e) {
      setErro(mensagemDeErro(e));
      setFase("transmitindo");
    }
  }, [aoMudar, enviar, pararTudo]);

  // Ao voltar para a tela, pede a tela acesa de novo; se saiu enquanto transmitia, avisa.
  useEffect(() => {
    const aoMudarVisibilidade = () => {
      if (!sessao.current) return;
      if (document.visibilityState === "hidden") { if (!noApp()) setSaiuDaTela(true); }
      else {
        void pedirTela();
        void enviar();
      }
    };
    const aoVoltarInternet = () => void enviar();
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    window.addEventListener("online", aoVoltarInternet);
    return () => {
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      window.removeEventListener("online", aoVoltarInternet);
    };
  }, [enviar, pedirTela]);

  // Sair da tela (trocar de página) encerra só a transmissão local; o servidor passa a mostrar "sem sinal".
  useEffect(
    () => () => {
      parar.current();
      if (temporizador.current) clearInterval(temporizador.current);
      void trava.current?.release().catch(() => {});
    },
    [],
  );

  return { fase, saidaId, ultima, naFila, semInternet, erroGps, erro, saiuDaTela, telaAcesa, iniciar, encerrar, dispensarAviso: () => setSaiuDaTela(false) };
}

/** Tela do motorista no celular: saídas dele hoje e o botão de rastreio. */
export function Motorista() {
  const { pode } = useSessao();
  const rastreia = pode("rastreio:transmitir");
  const lista = useCarregar((s) => (rastreia ? requisitar<SaidaMotorista[]>("/api/rastreio/minhas-saidas", { sinal: s }) : Promise.resolve([] as SaidaMotorista[])), [rastreia]);
  const t = useTransmissao(() => void lista.recarregar());

  return (
    <div className="pagina motorista">
      <div className="pagina__cabecalho">
        <div>
          <h1>Motorista</h1>
          <p className="pagina__descricao">{rastreia ? "Suas saídas de hoje. Ao iniciar o rastreio, os passageiros recebem o link para acompanhar o ônibus." : "Acesso rápido do motorista."}</p>
        </div>
      </div>

      {pode("frota:checklist") && (
        <p>
          <Link className="botao botao--secundario botao--bloco" to="/frota/checklist">
            <Icone nome="check" /> Checklist do veículo
          </Link>
        </p>
      )}

      {rastreia && (
        <>
          <Aviso tipo="atencao" titulo="Antes de sair">
            {noApp() ? AVISO_APP : AVISO_TELA_ABERTA}
          </Aviso>
          {t.erro && <Aviso tipo="erro">{t.erro}</Aviso>}
          {t.erroGps && (
            <Aviso tipo="erro">
              {noApp() && t.erroGps === "NEGADO" ? MENSAGEM_GPS_NEGADO_APP : MENSAGEM_ERRO_GPS[t.erroGps]}
              {noApp() && t.erroGps === "NEGADO" && (
                <> <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void gpsDoApp()?.openSettings()}>Abrir configurações</button></>
              )}
            </Aviso>
          )}
          {t.saiuDaTela && t.fase === "transmitindo" && (
            <Aviso tipo="atencao" titulo="Você saiu desta tela">
              O rastreio pode ter parado enquanto a tela estava apagada ou outro app aberto. Se o ônibus não aparece para a equipe, encerre e inicie de novo.{" "}
              <button type="button" className="botao botao--fantasma botao--pequeno" onClick={t.dispensarAviso}>
                Entendi
              </button>
            </Aviso>
          )}

          {lista.carregando && !lista.dados ? (
            <Carregando />
          ) : lista.erro ? (
            <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} />
          ) : !lista.dados?.length ? (
            <Vazio titulo="Você não está escalado como motorista em nenhuma saída de hoje.">
              <p className="texto-fraco">Se isso estiver errado, fale com a supervisão: a escala define quem pode transmitir.</p>
            </Vazio>
          ) : (
            lista.dados.map((s) => {
              const minha = t.saidaId === s.saidaId && t.fase !== "parado";
              const outraAtiva = t.fase !== "parado" && !minha;
              const abertaNoServidor = !!s.sessao && !minha;
              return (
                <section key={s.saidaId} className="cartao motorista__saida" aria-labelledby={`sd-${s.saidaId}`}>
                  <div>
                    <h2 id={`sd-${s.saidaId}`}>{s.passeio}</h2>
                    <p className="texto-fraco">
                      {formatarDataExtenso(s.data)}
                      {s.veiculo ? ` · ${s.veiculo}` : ""}
                    </p>
                  </div>
                  {minha && (
                    <div className={`motorista__estado${t.semInternet || t.erroGps ? " motorista__estado--alerta" : ""}`} role="status">
                      <span>{t.fase === "iniciando" ? "Iniciando…" : t.fase === "encerrando" ? "Encerrando…" : t.semInternet ? "Sem internet: guardando as posições" : "Transmitindo a posição do ônibus"}</span>
                      <small>
                        {t.ultima ? `Última posição às ${hora(t.ultima)}` : "Aguardando o primeiro sinal do GPS…"}
                        {t.naFila > 0 ? ` · ${t.naFila} na fila para enviar` : ""}
                        {t.telaAcesa === false && !noApp() ? " · Não consegui manter a tela acesa: não deixe o celular apagar." : ""}
                      </small>
                    </div>
                  )}
                  {abertaNoServidor && (
                    <Aviso tipo="info">O rastreio desta saída está aberto, mas este aparelho não está transmitindo. Toque em “Continuar rastreio”.</Aviso>
                  )}
                  {minha ? (
                    <button type="button" className="botao botao--perigo botao--grande" onClick={() => void t.encerrar()} disabled={t.fase !== "transmitindo"}>
                      Encerrar rastreio
                    </button>
                  ) : (
                    <button type="button" className="botao botao--primario botao--grande" onClick={() => void t.iniciar(s)} disabled={outraAtiva || t.fase === "iniciando"}>
                      {abertaNoServidor ? "Continuar rastreio" : "Iniciar rastreio"}
                    </button>
                  )}
                </section>
              );
            })
          )}
          <p className="campo__ajuda">O rastreio usa o GPS e a internet do celular (consumo baixo de dados, mas a bateria cai mais rápido). Só a posição do ônibus é enviada, e só enquanto o rastreio está ligado.</p>
        </>
      )}
    </div>
  );
}
