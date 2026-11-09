import { Outlet } from "react-router-dom";
import { AbasModulo } from "../../componentes/Pagina";
import "./financeiro.css";

const ABAS = [
  { para: "/financeiro", rotulo: "Resumo", fim: true },
  { para: "/financeiro/pagar", rotulo: "A pagar" },
  { para: "/financeiro/receber", rotulo: "A receber" },
  { para: "/financeiro/extrato", rotulo: "Extrato e conciliação" },
  { para: "/financeiro/cartoes", rotulo: "Cartões" },
  { para: "/financeiro/caixa", rotulo: "Caixa e saldos" },
  { para: "/financeiro/revenda", rotulo: "Revenda" },
  { para: "/financeiro/planilha", rotulo: "Importar planilha" },
  { para: "/financeiro/pendencias", rotulo: "Pendências" },
  { para: "/financeiro/contas", rotulo: "Contas e categorias" },
];

/** Moldura do módulo: título e abas. Cada aba é uma rota própria (menu e atalhos levam direto a ela). */
export function Financeiro() {
  return (
    <div className="pagina">
      <AbasModulo rotulo="Financeiro" itens={ABAS} />
      <Outlet />
    </div>
  );
}
