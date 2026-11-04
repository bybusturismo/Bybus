import { useEffect, useState } from "react";

/** Valor com atraso (debounce): só muda depois de `ms` sem novas mudanças. Evita uma requisição por tecla digitada. */
export function useAtraso<T>(valor: T, ms = 300): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}
