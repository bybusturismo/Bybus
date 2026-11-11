import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { Modal } from "../../componentes/Modal";
import { formatarMoeda } from "../../util/formato";

export interface RespostaVoucher {
  embarcados: Array<{ id: string; nome: string }>;
  jaEmbarcados: number;
  pagamento: string | null;
  valorACobrarCentavos: number | null;
}

/**
 * Check-in pelo QR Code do voucher da Paytour (pedido do dono, 11/11/2026): a câmera lê o número do ticket e o sistema
 * marca o embarque. Também aceita digitar o número (ou um leitor de código que "digita").
 */
export function LeitorVoucher({ saidaId, aoFechar, aoRegistrar }: { saidaId: string; aoFechar: () => void; aoRegistrar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [cameraErro, setCameraErro] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [resultado, setResultado] = useState<{ tipo: "ok" | "aviso" | "erro"; texto: string; cobrar?: string } | null>(null);
  const ocupado = useRef(false);
  const ultimo = useRef<{ codigo: string; em: number } | null>(null);

  async function enviar(c: string) {
    const limpo = c.trim();
    if (!limpo || ocupado.current) return;
    // A câmera lê o mesmo QR várias vezes por segundo: ignora a repetição por 4 s.
    if (ultimo.current && ultimo.current.codigo === limpo && Date.now() - ultimo.current.em < 4000) return;
    ultimo.current = { codigo: limpo, em: Date.now() };
    ocupado.current = true;
    try {
      const r = await api.post<RespostaVoucher>(`/api/saidas/${saidaId}/embarque/voucher`, { codigo: limpo });
      const cobrar = r.pagamento === "A_PAGAR" ? `A pagar no embarque${r.valorACobrarCentavos != null ? `: ${formatarMoeda(r.valorACobrarCentavos)}` : ""}` : undefined;
      if (r.embarcados.length) setResultado({ tipo: "ok", texto: `Embarcou: ${r.embarcados.map((p) => p.nome || "passageiro").join(", ")}`, cobrar });
      else setResultado({ tipo: "aviso", texto: `Já estava marcado como embarcado (${r.jaEmbarcados}).`, cobrar });
      try { navigator.vibrate?.(150); } catch { /* sem vibração */ }
      setCodigo("");
      aoRegistrar();
    } catch (e) {
      setResultado({ tipo: "erro", texto: mensagemDeErro(e) });
    } finally {
      ocupado.current = false;
    }
  }

  // Câmera traseira + leitura contínua (BarcodeDetector quando existe; senão jsQR, que funciona também no iPhone).
  useEffect(() => {
    let parar = false;
    let fluxo: MediaStream | null = null;
    let quadro = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setCameraErro("Este aparelho não liberou a câmera. Digite o número do voucher abaixo."); return; }
      try {
        fluxo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch {
        setCameraErro("A câmera não foi liberada. Permita o acesso à câmera no navegador ou digite o número do voucher abaixo.");
        return;
      }
      if (parar || !video.current) { fluxo.getTracks().forEach((t) => t.stop()); return; }
      video.current.srcObject = fluxo;
      await video.current.play().catch(() => undefined);
      const Detector = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
      const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;
      const jsQR = detector ? null : (await import("jsqr")).default;
      const ler = async () => {
        if (parar || !video.current) return;
        const v = video.current;
        if (v.readyState >= 2 && v.videoWidth) {
          try {
            if (detector) {
              const achados = await detector.detect(v);
              if (achados[0]?.rawValue) await enviar(achados[0].rawValue);
            } else if (jsQR && ctx) {
              const escala = Math.min(1, 640 / v.videoWidth);
              canvas.width = Math.round(v.videoWidth * escala);
              canvas.height = Math.round(v.videoHeight * escala);
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const achado = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
              if (achado?.data) await enviar(achado.data);
            }
          } catch { /* quadro ruim: tenta o próximo */ }
        }
        quadro = window.setTimeout(() => void ler(), 250);
      };
      void ler();
    })();
    return () => {
      parar = true;
      window.clearTimeout(quadro);
      fluxo?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function digitado(e: FormEvent) {
    e.preventDefault();
    ultimo.current = null;
    void enviar(codigo);
  }

  return (
    <Modal aberto titulo="Ler QR Code do voucher" aoFechar={aoFechar}>
      {cameraErro ? <Aviso tipo="atencao">{cameraErro}</Aviso> : (
        <div className="leitor-voucher">
          <video ref={video} className="leitor-voucher__video" muted playsInline aria-label="Imagem da câmera" />
          <span className="leitor-voucher__mira" aria-hidden="true" />
        </div>
      )}
      <p className="texto-fraco">Aponte a câmera para o QR Code do voucher (no celular do passageiro ou impresso). Cada leitura marca o embarque na hora.</p>
      {resultado && (
        <div role="status" className={`leitor-voucher__resultado leitor-voucher__resultado--${resultado.tipo}`}>
          <strong>{resultado.tipo === "erro" ? <Icone nome="x" /> : <Icone nome="check" />} {resultado.texto}</strong>
          {resultado.cobrar && <div className="leitor-voucher__cobrar">{resultado.cobrar}</div>}
        </div>
      )}
      <form onSubmit={digitado} className="leitor-voucher__digitar">
        <div className="campo">
          <label htmlFor="voucher-codigo">Ou digite o número do voucher (Ticket)</label>
          <input id="voucher-codigo" inputMode="numeric" autoComplete="off" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ex.: 924074225171781496807" />
        </div>
        <button type="submit" className="botao botao--primario" disabled={!codigo.trim()}>Registrar embarque</button>
      </form>
    </Modal>
  );
}
