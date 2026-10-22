import { render } from "@testing-library/react";
import { vi } from "vitest";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { Perfil, Permissao, UnidadeResumo } from "../api/tipos";
import { ProvedorNotificacoes } from "../componentes/Notificacoes";
import { SessaoFixa, type ValorSessao } from "../sessao/Sessao";

export const FLN: UnidadeResumo = { id: "aaaaaaaa-0000-4000-8000-000000000001", codigo: "FLN", nome: "Florianópolis" };
export const BC: UnidadeResumo = { id: "aaaaaaaa-0000-4000-8000-000000000002", codigo: "BC", nome: "Balneário Camboriú" };

/** Sessão fictícia para testes de componentes. */
export function sessaoFicticia(
  perfil: Perfil,
  permissoes: Permissao[],
  opcoes: { unidades?: UnidadeResumo[]; praca?: string; todasUnidades?: boolean; escolherPraca?: (id: string) => void } = {},
): ValorSessao {
  const unidades = opcoes.unidades ?? [FLN];
  const usuario = { id: "u1", nome: `${perfil} Teste`, email: "teste@bybus.test", perfil, perfilNome: perfil, todasUnidades: opcoes.todasUnidades ?? false, totpAtivo: false };
  return {
    estado: { fase: "autenticado", usuario, pendencia: null, permissoes, unidades },
    usuario,
    pode: (p) => permissoes.includes(p),
    unidades,
    praca: opcoes.praca ?? "",
    escolherPraca: opcoes.escolherPraca ?? (() => {}),
    recarregar: async () => {},
    sair: async () => {},
  };
}

export function renderizar(ui: ReactElement, opcoes: { sessao?: ValorSessao; rota?: string } = {}) {
  const sessao = opcoes.sessao ?? sessaoFicticia("ADMIN", []);
  return render(
    <MemoryRouter initialEntries={[opcoes.rota ?? "/"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SessaoFixa valor={sessao}>
        <ProvedorNotificacoes>{ui}</ProvedorNotificacoes>
      </SessaoFixa>
    </MemoryRouter>,
  );
}

export function respostaJson(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

type Resposta = unknown | ((corpo: unknown, url: string) => unknown);

/**
 * Simula a API por rota: chaves "GET /api/x" (caminho sem query) → corpo da resposta.
 * Devolve o spy para conferir chamadas. Rota não mapeada responde 404.
 */
export function simularApi(rotas: Record<string, Resposta>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (entrada, init) => {
    const url = String(entrada);
    const metodo = (init?.method ?? "GET").toUpperCase();
    const caminho = url.split("?")[0];
    const chave = `${metodo} ${caminho}`;
    if (!(chave in rotas)) return respostaJson(404, { codigo: "NAO_ENCONTRADO", mensagem: `Rota não simulada: ${chave}` });
    const r = rotas[chave];
    const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
    return respostaJson(200, typeof r === "function" ? (r as (c: unknown, u: string) => unknown)(corpo, url) : r);
  });
}

/** Corpo JSON enviado na n-ésima chamada a "METODO caminho". */
export function corpoEnviado(spy: ReturnType<typeof simularApi>, metodo: string, caminho: string, n = 0): unknown {
  const chamadas = spy.mock.calls.filter(([u, i]) => String(u).split("?")[0] === caminho && ((i?.method ?? "GET").toUpperCase() === metodo));
  const init = chamadas[n]?.[1];
  return init?.body ? JSON.parse(String(init.body)) : undefined;
}
