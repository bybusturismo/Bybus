import type { ReactNode } from "react";
import { BrowserRouter, MemoryRouter, Navigate, Route, Routes } from "react-router-dom";

// Na demonstração publicada não há endereços próprios: a navegação fica em memória.
const Roteador = import.meta.env.VITE_DEMO === "1" ? MemoryRouter : BrowserRouter;
import type { Permissao } from "./api/tipos";
import { ErroCarga, Carregando, SemAcesso } from "./componentes/Estados";
import { Layout } from "./componentes/Layout";
import { ProvedorNotificacoes } from "./componentes/Notificacoes";
import { Auditoria } from "./paginas/Auditoria";
import { Conta } from "./paginas/Conta";
import { Importar } from "./paginas/importar/Importar";
import { Login } from "./paginas/Login";
import { TelaPendencia } from "./paginas/Pendencias";
import { Embarque } from "./paginas/saida/Embarque";
import { ListaPassageiros } from "./paginas/saida/ListaPassageiros";
import { Reservas } from "./paginas/saida/Reservas";
import { SaidaLayout } from "./paginas/saida/SaidaLayout";
import { Saidas } from "./paginas/Saidas";
import { Usuarios } from "./paginas/Usuarios";
import { Equipe } from "./paginas/Equipe";
import { Passeios } from "./paginas/Passeios";
import { Perfis } from "./paginas/Perfis";
import { Pracas } from "./paginas/Pracas";
import { ProvedorSessao, useSessao } from "./sessao/Sessao";

/** Esconde a tela de quem não tem a permissão (o servidor também recusa). */
function Exige({ permissao, children }: { permissao: Permissao; children: ReactNode }) {
  const { pode } = useSessao();
  return pode(permissao) ? <>{children}</> : <SemAcesso />;
}

function Inicio() {
  const { pode } = useSessao();
  return <Navigate to={pode("manifesto:ver") ? "/saidas" : "/conta"} replace />;
}

export function Rotas() {
  const { estado, recarregar, sair } = useSessao();

  if (estado.fase === "carregando") return <Carregando texto="Abrindo o Bybus Gestão…" />;
  if (estado.fase === "erro")
    return (
      <main className="tela-acesso" id="conteudo">
        <ErroCarga mensagem={estado.mensagem} tentarDeNovo={() => void recarregar()} />
      </main>
    );
  if (estado.fase === "anonimo") return <Login aviso={estado.aviso} aoEntrar={recarregar} />;
  if (estado.pendencia) return <TelaPendencia tipo={estado.pendencia} aoConcluir={recarregar} aoSair={() => void sair()} />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Inicio />} />
        <Route
          path="saidas"
          element={
            <Exige permissao="manifesto:ver">
              <Saidas />
            </Exige>
          }
        />
        <Route
          path="saidas/:id"
          element={
            <Exige permissao="manifesto:ver">
              <SaidaLayout />
            </Exige>
          }
        >
          <Route index element={<ListaPassageiros />} />
          <Route path="reservas" element={<Reservas />} />
          <Route path="embarque" element={<Embarque />} />
        </Route>
        <Route
          path="importar"
          element={
            <Exige permissao="importacoes:executar">
              <Importar />
            </Exige>
          }
        />
        <Route
          path="equipe"
          element={
            <Exige permissao="pessoas:ver">
              <Equipe />
            </Exige>
          }
        />
        <Route
          path="passeios"
          element={
            <Exige permissao="produtos:gerenciar">
              <Passeios />
            </Exige>
          }
        />
        <Route
          path="pracas"
          element={
            <Exige permissao="unidades:gerenciar">
              <Pracas />
            </Exige>
          }
        />
        <Route
          path="perfis"
          element={
            <Exige permissao="usuarios:gerenciar">
              <Perfis />
            </Exige>
          }
        />
        <Route
          path="usuarios"
          element={
            <Exige permissao="usuarios:gerenciar">
              <Usuarios />
            </Exige>
          }
        />
        <Route
          path="auditoria"
          element={
            <Exige permissao="auditoria:ver">
              <Auditoria />
            </Exige>
          }
        />
        <Route path="conta" element={<Conta />} />
        <Route
          path="*"
          element={
            <div className="estado estado--vazio">
              <p className="estado__titulo">Página não encontrada.</p>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <Roteador future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ProvedorSessao>
        <ProvedorNotificacoes>
          <Rotas />
        </ProvedorNotificacoes>
      </ProvedorSessao>
    </Roteador>
  );
}
