import { useEffect, useRef, useState, type ReactNode } from "react";

const mm = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** O navegador consegue gravar a tela? (Na demonstração não grava: não há servidor para guardar o vídeo.) */
export const podeGravarTela = () =>
  import.meta.env.VITE_DEMO !== "1" && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== "undefined";

/**
 * Gravar a tela (getDisplayMedia + microfone opcional + MediaRecorder). O navegador pergunta qual tela, janela ou aba gravar.
 * Enquanto grava, uma pílula fixa mostra o tempo e o botão "Parar". O vídeo (webm) vai para `aoGravar`.
 */
export function useGravarTela(aoGravar: (video: Blob) => Promise<void>, aviso: (texto: string) => void) {
  const [estado, setEstado] = useState<"parado" | "gravando" | "enviando">("parado");
  const [seg, setSeg] = useState(0);
  const gravador = useRef<MediaRecorder | null>(null);
  const fluxos = useRef<MediaStream[]>([]);

  useEffect(() => {
    if (estado !== "gravando") return undefined;
    const t = setInterval(() => setSeg((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [estado]);
  // sair da página no meio da gravação libera a tela e o microfone
  useEffect(() => () => fluxos.current.forEach((f) => f.getTracks().forEach((x) => x.stop())), []);

  const soltar = () => {
    fluxos.current.forEach((f) => f.getTracks().forEach((x) => x.stop()));
    fluxos.current = [];
  };

  async function iniciar(comMicrofone: boolean) {
    if (!podeGravarTela()) {
      aviso(import.meta.env.VITE_DEMO === "1" ? "Na demonstração não é possível gravar a tela." : "Este navegador não grava a tela. Use o Chrome ou o Edge no computador.");
      return;
    }
    try {
      const tela = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 24 }, audio: true });
      fluxos.current = [tela];
      const faixas: MediaStreamTrack[] = [...tela.getVideoTracks()];
      const audios: MediaStreamTrack[] = [...tela.getAudioTracks()];
      if (comMicrofone) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          fluxos.current.push(mic);
          audios.push(...mic.getAudioTracks());
        } catch {
          aviso("Sem acesso ao microfone: gravando só a tela.");
        }
      }
      if (audios.length > 1) {
        // várias fontes de som viram uma só faixa
        const ctx = new AudioContext();
        const destino = ctx.createMediaStreamDestination();
        audios.forEach((a) => ctx.createMediaStreamSource(new MediaStream([a])).connect(destino));
        faixas.push(...destino.stream.getAudioTracks());
      } else faixas.push(...audios);
      const tipo = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(new MediaStream(faixas), tipo ? { mimeType: tipo, videoBitsPerSecond: 1_500_000 } : undefined);
      const partes: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
      r.onstop = async () => {
        soltar();
        setEstado("enviando");
        try {
          await aoGravar(new Blob(partes, { type: "video/webm" }));
        } catch (e) {
          aviso((e as Error).message);
        }
        setEstado("parado");
      };
      // "Parar compartilhamento" do próprio navegador também encerra
      tela.getVideoTracks()[0]?.addEventListener("ended", () => { if (r.state === "recording") r.stop(); });
      gravador.current = r;
      r.start(1000);
      setSeg(0);
      setEstado("gravando");
    } catch (e) {
      soltar();
      if ((e as Error).name !== "NotAllowedError") aviso((e as Error).message);
    }
  }
  const parar = () => { if (gravador.current?.state === "recording") gravador.current.stop(); };

  const pilula: ReactNode =
    estado === "parado" ? null : (
      <div className="pilula-gravando" role="status" aria-live="polite">
        {estado === "gravando" ? (
          <>
            <span className="pilula-gravando__ponto" aria-hidden="true" /> Gravando a tela · {mm(seg)}
            <button type="button" className="botao botao--pequeno" onClick={parar}>Parar</button>
          </>
        ) : (
          <>Salvando o vídeo na página…</>
        )}
      </div>
    );
  return { iniciar, parar, estado, pilula };
}
