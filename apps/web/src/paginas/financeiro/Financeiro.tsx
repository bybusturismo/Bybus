import { NavLink, Outlet } from "react-router-dom";
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
  { para: "/financeiro/contas", rotulo: "Contas e categorias" },
];

/** Moldura do módulo: título e abas. Cada aba é uma rota própria (menu e atalhos levam direto a ela). */
export function Financeiro() {
  return (
    <div className="pagina">
      <nav className="abas fin-abas" aria-label="Financeiro">
        {ABAS.map((a) => (
          <NavLink key={a.para} to={a.para} end={a.fim} className={({ isActive }) => `aba${isActive ? " aba--ativa" : ""}`}>
            {a.rotulo}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
