import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { aoErroDeSessao, api, ErroApi, requisitar } from "../api/cliente";
import type { Pendencia, Permissao, RespostaEu, UnidadeResumo } from "../api/tipos";

type Estado =
  | { fase: "carregando" }
  | { fase: "anonimo"; aviso?: string }
  | { fase: "autenticado"; usuario: RespostaEu["usuario"]; pendencia: Pendencia; permissoes: Permissao[]; unidades: UnidadeResumo[] }
  | { fase: "erro"; mensagem: string };

interface ValorSessao {
  estado: Estado;
  usuario: RespostaEu["usuario"] | null;
  /** Só esconde o que o perfil não usa — a permissão real é sempre conferida no servidor. */
  pode: (p: Permissao) => boolean;
  /** Praças que o usuário acessa (o servidor também filtra tudo por elas). */
  unidades: UnidadeResumo[];
  /** Praça escolhida no seletor do topo ("" = todas as praças do usuário). */
  praca: string;
  escolherPraca: (id: string) => void;
  recarregar: () => Promise<void>;
  sair: () => Promise<void>;
}

const CHAVE_PRACA = "bybus.praca";

function lerPraca(): string {
  try {
    return localStorage.getItem(CHAVE_PRACA) ?? "";
  } catch {
    return "";
  }
}

/** Nome da praça pelo id (ou o próprio id, se desconhecida). */
export function nomePraca(unidades: UnidadeResumo[], id: string | null | undefined): string {
  if (!id) return "Todas as praças";
  return unidades.find((u) => u.id === id)?.nome ?? "Outra praça";
}

const Contexto = createContext<ValorSessao | null>(null);

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [pracaSalva, setPracaSalva] = useState<string>(lerPraca);

  const escolherPraca = useCallback((id: string) => {
    setPracaSalva(id);
    try {
      localStorage.setItem(CHAVE_PRACA, id);
    } catch {
      /* sem armazenamento: a escolha vale só nesta visita */
    }
  }, []);

  const recarregar = useCallback(async () => {
    try {
      const eu = await requisitar<RespostaEu>("/api/auth/eu", { semAvisoSessao: true });
      setEstado({ fase: "autenticado", usuario: eu.usuario, pendencia: eu.pendencia, permissoes: eu.permissoes, unidades: eu.unidades ?? [] });
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
    const unidades = estado.fase === "autenticado" ? estado.unidades : [];
    // Escolha salva só vale se a praça ainda for do usuário; com uma praça só, não há o que escolher.
    const praca = unidades.length > 1 && unidades.some((u) => u.id === pracaSalva) ? pracaSalva : "";
    return {
      estado,
      usuario: estado.fase === "autenticado" ? estado.usuario : null,
      pode: (p) => permissoes.includes(p),
      unidades,
      praca,
      escolherPraca,
      recarregar,
      sair,
    };
  }, [estado, pracaSalva, escolherPraca, recarregar, sair]);

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
