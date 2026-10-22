import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { aoErroDeSessao, api, ErroApi, requisitar } from "../api/cliente";
import type { Pendencia, Permissao, RespostaEu, Usuario } from "../api/tipos";

type Estado =
  | { fase: "carregando" }
  | { fase: "anonimo"; aviso?: string }
  | { fase: "autenticado"; usuario: RespostaEu["usuario"]; pendencia: Pendencia; permissoes: Permissao[] }
  | { fase: "erro"; mensagem: string };

interface ValorSessao {
  estado: Estado;
  usuario: (Usuario & { totpAtivo: boolean }) | null;
  /** Só esconde o que o perfil não usa — a permissão real é sempre conferida no servidor. */
  pode: (p: Permissao) => boolean;
  recarregar: () => Promise<void>;
  sair: () => Promise<void>;
}

const Contexto = createContext<ValorSessao | null>(null);

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });

  const recarregar = useCallback(async () => {
    try {
      const eu = await requisitar<RespostaEu>("/api/auth/eu", { semAvisoSessao: true });
      setEstado({ fase: "autenticado", usuario: eu.usuario, pendencia: eu.pendencia, permissoes: eu.permissoes });
    } catch (e) {
      if (e instanceof ErroApi && e.status === 401) setEstado({ fase: "anonimo" });
      else setEstado({ fase: "erro", mensagem: e instanceof Error ? e.message : "Erro ao carregar a sessão." });
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  useEffect(
    () =>
      aoErroDeSessao((erro) => {
        if (erro.status === 401) setEstado({ fase: "anonimo", aviso: "Sua sessão expirou. Entre novamente." });
        else void recarregar();
      }),
    [recarregar],
  );

  const sair = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      setEstado({ fase: "anonimo", aviso: "Você saiu do sistema." });
    }
  }, []);

  const valor = useMemo<ValorSessao>(() => {
    const permissoes = estado.fase === "autenticado" ? estado.permissoes : [];
    return {
      estado,
      usuario: estado.fase === "autenticado" ? estado.usuario : null,
      pode: (p) => permissoes.includes(p),
      recarregar,
      sair,
    };
  }, [estado, recarregar, sair]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): ValorSessao {
  const v = useContext(Contexto);
  if (!v) throw new Error("useSessao fora do ProvedorSessao");
  return v;
}

/** Para testes: injeta uma sessão pronta. */
export function SessaoFixa({ valor, children }: { valor: ValorSessao; children: ReactNode }) {
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
export type { ValorSessao };
