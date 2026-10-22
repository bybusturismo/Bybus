import { useEffect, useState } from "react";
import { Icone } from "./Icone";

type Tema = "claro" | "escuro" | "sistema";
const CHAVE = "bybus.tema";

function lerTema(): Tema {
  try {
    const v = localStorage.getItem(CHAVE);
    return v === "claro" || v === "escuro" ? v : "sistema";
  } catch {
    return "sistema";
  }
}

export function aplicarTema(t: Tema = lerTema()) {
  const raiz = document.documentElement;
  if (t === "sistema") raiz.removeAttribute("data-theme");
  else raiz.setAttribute("data-theme", t === "escuro" ? "dark" : "light");
}

/** Alterna claro/escuro (preferência guardada só neste navegador). */
export function BotaoTema() {
  const [tema, setTema] = useState<Tema>(lerTema);
  useEffect(() => {
    aplicarTema(tema);
    try {
      if (tema === "sistema") localStorage.removeItem(CHAVE);
      else localStorage.setItem(CHAVE, tema);
    } catch {
      /* armazenamento indisponível: segue só nesta aba */
    }
  }, [tema]);

  const escuroAtivo = tema === "escuro" || (tema === "sistema" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  return (
    <button
      type="button"
      className="botao botao--fantasma botao--icone botao--topo"
      onClick={() => setTema(escuroAtivo ? "claro" : "escuro")}
      aria-label={escuroAtivo ? "Usar tema claro" : "Usar tema escuro"}
      title={escuroAtivo ? "Tema claro" : "Tema escuro"}
    >
      <Icone nome={escuroAtivo ? "sol" : "lua"} />
    </button>
  );
}
