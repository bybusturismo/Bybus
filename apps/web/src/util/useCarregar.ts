import { useCallback, useEffect, useRef, useState } from "react";
import { mensagemDeErro } from "../api/cliente";

export interface Carregamento<T> {
  dados: T | null;
  carregando: boolean;
  erro: string | null;
  recarregar: () => Promise<void>;
  /** Atualiza os dados localmente (atualização otimista). */
  definir: (fn: (atual: T | null) => T | null) => void;
}

/** Carrega dados de uma função assíncrona, cancelando respostas antigas quando as dependências mudam. */
export function useCarregar<T>(carregar: (sinal: AbortSignal) => Promise<T>, deps: unknown[]): Carregamento<T> {
  const [dados, setDados] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const controle = useRef<AbortController | null>(null);

  const executar = useCallback(carregar, deps);

  const recarregar = useCallback(async () => {
    controle.current?.abort();
    const c = new AbortController();
    controle.current = c;
    setCarregando(true);
    setErro(null);
    try {
      const r = await executar(c.signal);
      if (!c.signal.aborted) setDados(r);
    } catch (e) {
      if (!c.signal.aborted && (e as Error).name !== "AbortError") setErro(mensagemDeErro(e));
    } finally {
      if (!c.signal.aborted) setCarregando(false);
    }
  }, [executar]);

  useEffect(() => {
    void recarregar();
    return () => controle.current?.abort();
  }, [recarregar]);

  return { dados, carregando, erro, recarregar, definir: (fn) => setDados((d) => fn(d)) };
}
