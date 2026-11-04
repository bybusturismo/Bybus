import { useEffect, useRef, useState, type PointerEvent as EventoPonteiro } from "react";
import { useLocation } from "react-router-dom";
import { Mascote } from "./Mascote";

/**
 * Turistinha solto no canto inferior direito (pedido do dono, 04/11/2026, no modelo do app TOMA):
 * botão em 3D que abre o assistente. Clique abre; arrastar muda de lugar (guardado neste aparelho).
 */
const celular = () => !(window.matchMedia?.("(min-width: 900px)").matches ?? true);
const chave = () => `bybus.turistinha.lugar.${celular() ? "celular" : "computador"}`;
const padrao = () => ({ d: celular() ? 12 : 24, b: celular() ? 16 : 24 });
function ler(): { d: number; b: number } {
  try {
    return { ...padrao(), ...JSON.parse(localStorage.getItem(chave()) ?? "{}") };
  } catch {
    return padrao();
  }
}
const FRASES: Array<[RegExp, string]> = [
  [/^\/saidas\/[^/]+/, "Pergunte sobre esta saída"],
  [/^\/financeiro/, "Dúvidas sobre o financeiro?"],
  [/^\/frota/, "Pergunte sobre a frota"],
  [/^\/saidas$/, "Como posso ajudar hoje?"],
];

export function TuristinhaFlutuante({ aberto, aoAlternar }: { aberto: boolean; aoAlternar: () => void }) {
  const local = useLocation();
  const [lugar, setLugar] = useState(ler);
  const [balao, setBalao] = useState(true);
  const [arrastando, setArrastando] = useState(false);
  const toque = useRef<{ x: number; y: number; d: number; b: number; moveu: boolean } | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBalao(true);
    const t = setTimeout(() => setBalao(false), 3500);
    return () => clearTimeout(t);
  }, [local.pathname]);
  useEffect(() => {
    const r = () => setLugar(ler());
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);

  const limitar = ({ d, b }: { d: number; b: number }) => {
    const w = caixa.current?.offsetWidth ?? 80;
    const h = caixa.current?.offsetHeight ?? 90;
    return { d: Math.min(Math.max(6, d), window.innerWidth - w - 6), b: Math.min(Math.max(6, b), window.innerHeight - h - 6) };
  };
  const pos = limitar(lugar);

  function descer(e: EventoPonteiro<HTMLButtonElement>) {
    if (e.button) return;
    toque.current = { x: e.clientX, y: e.clientY, d: pos.d, b: pos.b, moveu: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function mover(e: EventoPonteiro<HTMLButtonElement>) {
    const t = toque.current;
    if (!t) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (!t.moveu && Math.hypot(dx, dy) < 6) return;
    t.moveu = true;
    setArrastando(true);
    setBalao(false);
    setLugar(limitar({ d: t.d - dx, b: t.b - dy }));
  }
  function soltar() {
    const t = toque.current;
    toque.current = null;
    setArrastando(false);
    if (!t) return;
    if (!t.moveu) return aoAlternar();
    setLugar((l) => {
      try {
        localStorage.setItem(chave(), JSON.stringify(l));
      } catch {
        /* sem armazenamento: vale só nesta visita */
      }
      return l;
    });
  }

  const frase = FRASES.find(([re]) => re.test(local.pathname))?.[1] ?? "Pergunte ao Turistinha";
  return (
    <div ref={caixa} className={`turistinha-flutuante nao-imprimir${aberto ? " turistinha-flutuante--aberto" : ""}`} style={{ right: pos.d, bottom: pos.b }}>
      <span className={`turistinha-flutuante__balao${balao && !arrastando && !aberto ? " turistinha-flutuante__balao--visivel" : ""}`} aria-hidden="true">{frase}</span>
      <button type="button" className={`turistinha-flutuante__botao${arrastando ? " turistinha-flutuante__botao--arrastando" : ""}`}
        onPointerDown={descer} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aoAlternar(); } }}
        aria-expanded={aberto} aria-controls="painel-turistinha"
        aria-label={aberto ? "Fechar o Turistinha (assistente)" : "Abrir o Turistinha (assistente)"} title="Turistinha: clique para conversar, arraste para mudar de lugar">
        <span className="turistinha-flutuante__base" aria-hidden="true" />
        <span className="turistinha-flutuante__figura"><Mascote tamanho={celular() ? 48 : 58} titulo="" /></span>
      </button>
    </div>
  );
}
