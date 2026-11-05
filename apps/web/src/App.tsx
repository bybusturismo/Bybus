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
import { Gestores } from "./paginas/Gestores";
import { Importar } from "./paginas/importar/Importar";
import { Integracoes } from "./paginas/Integracoes";
import { EmBreve } from "./paginas/EmBreve";
import { Escala } from "./paginas/Escala";
import { Conferencia } from "./paginas/Conferencia";
import { Fechamento } from "./paginas/Fechamento";
import { Whatsapp } from "./paginas/Whatsapp";
import { EmbarquePublico } from "./paginas/EmbarquePublico";
import { RastreioPublico } from "./paginas/RastreioPublico";
import { Motorista } from "./paginas/rastreio/Motorista";
import { Rastreamento } from "./paginas/rastreio/Rastreamento";
import { Transfer } from "./paginas/transfer/Transfer";
import { MotoristaTransfer } from "./paginas/transfer/MotoristaTransfer";
import { AbastecimentoPagina } from "./paginas/frota/Abastecimento";
import { ChecklistPagina } from "./paginas/frota/Checklist";
import { DocumentosPagina } from "./paginas/frota/Documentos";
import { ManutencaoPagina } from "./paginas/frota/Manutencao";
import { PainelFrotaPagina } from "./paginas/frota/Painel";
import { VeiculosPagina } from "./paginas/frota/Veiculos";
import { Cartoes } from "./paginas/financeiro/Cartoes";
import { ContasCategorias } from "./paginas/financeiro/ContasCategorias";
import { Extrato } from "./paginas/financeiro/Extrato";
import { Financeiro } from "./paginas/financeiro/Financeiro";
import { Lancamentos } from "./paginas/financeiro/Lancamentos";
import { Resumo } from "./paginas/financeiro/Resumo";
import { Login } from "./paginas/Login";
import { Configuracoes } from "./paginas/Configuracoes";
import { TelaPendencia } from "./paginas/Pendencias";
import { Embarque } from "./paginas/saida/Embarque";
import { ListaPassageiros } from "./paginas/saida/ListaPassageiros";
import { Reservas } from "./paginas/saida/Reservas";
import { SaidaLayout } from "./paginas/saida/SaidaLayout";
import { Saidas } from "./paginas/Saidas";
import { VisaoGeral } from "./paginas/visao-geral/VisaoGeral";
import { ListaDeReservas } from "./paginas/visao-geral/ListaReservas";
import { Usuarios } from "./paginas/Usuarios";
import { Equipe } from "./paginas/Equipe";
import { Passeios } from "./paginas/Passeios";
import { Perfis } from "./paginas/Perfis";
import { Pracas } from "./paginas/Pracas";
import { Biblioteca } from "./paginas/biblioteca/Biblioteca";
import { Afiliados } from "./paginas/marketing/Afiliados";
import { Avaliacoes } from "./paginas/marketing/Avaliacoes";
import { Campanhas } from "./paginas/marketing/Campanhas";
import { Canais } from "./paginas/marketing/Canais";
import { Conteudo } from "./paginas/marketing/Conteudo";
import { Origem } from "./paginas/marketing/Origem";
import { ProvedorSessao, useSessao } from "./sessao/Sessao";

/** Esconde a tela de quem não tem a permissão (o servidor também recusa). */
function Exige({ permissao, children }: { permissao: Permissao; children: ReactNode }) {
  const { pode } = useSessao();
  return pode(permissao) ? <>{children}</> : <SemAcesso />;
}

function ExigeUma({ permissoes, children }: { permissoes: Permissao[]; children: ReactNode }) {
  const { pode } = useSessao();
  return permissoes.some((p) => pode(p)) ? <>{children}</> : <SemAcesso />;
}

function Inicio() {
  const { pode } = useSessao();
  // Motorista (transmite o rastreio ou só faz o checklist) cai direto na tela dele, no celular.
  // Motorista só do transfer (sem rastreio) cai na lista do transfer dele.
  if (!pode("saidas:decidir") && pode("transfer:operar") && !pode("rastreio:transmitir")) return <Navigate to="/transfer/motorista" replace />;
  const soMotorista = !pode("saidas:decidir") && (pode("rastreio:transmitir") || (!pode("manifesto:ver") && pode("frota:checklist")));
  if (soMotorista) return <Navigate to="/motorista" replace />;
  // Quem vê a lista de passageiros entra na Visão Geral; os blocos mostram só o que o perfil pode ver.
  return pode("manifesto:ver") ? <VisaoGeral /> : <Navigate to="/conta" replace />;
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
          path="reservas"
          element={
            <Exige permissao="manifesto:ver">
              <ListaDeReservas />
            </Exige>
          }
        />
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
          path="rastreamento"
          element={
            <Exige permissao="manifesto:ver">
              <Rastreamento />
            </Exige>
          }
        />
        <Route
          path="motorista"
          element={
            <ExigeUma permissoes={["rastreio:transmitir", "frota:checklist"]}>
              <Motorista />
            </ExigeUma>
          }
        />
        <Route
          path="transfer"
          element={
            <Exige permissao="manifesto:ver">
              <Transfer />
            </Exige>
          }
        />
        <Route
          path="transfer/motorista"
          element={
            <Exige permissao="transfer:operar">
              <MotoristaTransfer />
            </Exige>
          }
        />
        <Route
          path="importar"
          element={
            <Exige permissao="importacoes:executar">
              <Importar />
            </Exige>
          }
        />
        <Route
          path="conferencia"
          element={
            <Exige permissao="reservas:editar">
              <Conferencia />
            </Exige>
          }
        />
        <Route
          path="listas"
          element={
            <Exige permissao="manifesto:ver">
              <Fechamento />
            </Exige>
          }
        />
        <Route path="fechamento" element={<Navigate to="/listas" replace />} />
        <Route
          path="whatsapp"
          element={
            <Exige permissao="whatsapp:ver">
              <Whatsapp />
            </Exige>
          }
        />
        <Route
          path="escala"
          element={
            <Exige permissao="pessoas:ver">
              <Escala />
            </Exige>
          }
        />
        <Route
          path="frota"
          element={
            <Exige permissao="frota:ver">
              <PainelFrotaPagina />
            </Exige>
          }
        />
        <Route
          path="frota/veiculos"
          element={
            <Exige permissao="frota:ver">
              <VeiculosPagina />
            </Exige>
          }
        />
        <Route
          path="frota/documentos"
          element={
            <Exige permissao="frota:ver">
              <DocumentosPagina />
            </Exige>
          }
        />
        <Route
          path="frota/manutencao"
          element={
            <Exige permissao="frota:ver">
              <ManutencaoPagina />
            </Exige>
          }
        />
        <Route
          path="frota/abastecimento"
          element={
            <Exige permissao="frota:ver">
              <AbastecimentoPagina />
            </Exige>
          }
        />
        <Route
          path="frota/checklist"
          element={
            <ExigeUma permissoes={["frota:checklist", "frota:ver"]}>
              <ChecklistPagina />
            </ExigeUma>
          }
        />
        <Route
          path="financeiro"
          element={
            <Exige permissao="financeiro:ver">
              <Financeiro />
            </Exige>
          }
        >
          <Route index element={<Resumo />} />
          <Route path="pagar" element={<Lancamentos tipo="PAGAR" />} />
          <Route path="receber" element={<Lancamentos tipo="RECEBER" />} />
          <Route path="extrato" element={<Extrato />} />
          <Route path="cartoes" element={<Cartoes />} />
          <Route path="contas" element={<ContasCategorias />} />
        </Route>
        <Route
          path="em-breve/:modulo"
          element={
            <Exige permissao="usuarios:gerenciar">
              <EmBreve />
            </Exige>
          }
        />
        <Route
          path="integracoes"
          element={
            <Exige permissao="importacoes:executar">
              <Integracoes />
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
          path="gestores"
          element={
            <Exige permissao="ia:gestores">
              <Gestores />
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
        <Route
          path="marketing/canais"
          element={
            <Exige permissao="marketing:ver">
              <Canais />
            </Exige>
          }
        />
        <Route
          path="marketing/origem"
          element={
            <Exige permissao="marketing:ver">
              <Origem />
            </Exige>
          }
        />
        <Route
          path="marketing/campanhas"
          element={
            <Exige permissao="marketing:ver">
              <Campanhas />
            </Exige>
          }
        />
        <Route
          path="marketing/conteudo"
          element={
            <Exige permissao="marketing:ver">
              <Conteudo />
            </Exige>
          }
        />
        <Route
          path="marketing/avaliacoes"
          element={
            <Exige permissao="marketing:ver">
              <Avaliacoes />
            </Exige>
          }
        />
        <Route
          path="marketing/afiliados"
          element={
            <Exige permissao="marketing:ver">
              <Afiliados />
            </Exige>
          }
        />
        <Route
          path="biblioteca"
          element={
            <Exige permissao="biblioteca:ver">
              <Biblioteca />
            </Exige>
          }
        />
        <Route
          path="biblioteca/:id"
          element={
            <Exige permissao="biblioteca:ver">
              <Biblioteca />
            </Exige>
          }
        />
        <Route path="conta" element={<Conta />} />
        <Route path="configuracoes" element={<Configuracoes />} />
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
  // Link público do passageiro (sem login nem sessão).
  const publico = /^\/embarque\/([A-Za-z0-9_-]{20,64})$/.exec(window.location.pathname);
  if (publico) return <EmbarquePublico token={publico[1]!} />;
  // Link de acompanhamento do ônibus (sem login nem sessão).
  const rastreio = /^\/rastreio\/([A-Za-z0-9_-]{20,64})$/.exec(window.location.pathname);
  if (rastreio) return <RastreioPublico token={rastreio[1]!} />;
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
