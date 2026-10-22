import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { Perfil, Permissao } from "../api/tipos";
import { ProvedorNotificacoes } from "../componentes/Notificacoes";
import { SessaoFixa, type ValorSessao } from "../sessao/Sessao";

/** Sessão fictícia para testes de componentes. */
export function sessaoFicticia(perfil: Perfil, permissoes: Permissao[]): ValorSessao {
  const usuario = { id: "u1", nome: `${perfil} Teste`, email: "teste@bybus.test", perfil, totpAtivo: false };
  return {
    estado: { fase: "autenticado", usuario, pendencia: null, permissoes },
    usuario,
    pode: (p) => permissoes.includes(p),
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
