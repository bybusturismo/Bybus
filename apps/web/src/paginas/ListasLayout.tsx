import { Outlet } from "react-router-dom";
import { AbasModulo, type ItemAba } from "../componentes/Pagina";
import { useSessao } from "../sessao/Sessao";

/** Moldura de "Listas de passageiros": listas do dia, todas as saídas e conferência (cada aba é uma rota; só aparecem as que o perfil pode abrir). */
export function ListasLayout() {
  const { pode } = useSessao();
  const abas: ItemAba[] = [
    ...(pode("manifesto:ver") ? [{ para: "/listas", rotulo: "Listas do dia", fim: true }, { para: "/listas/saidas", rotulo: "Todas as saídas" }] : []),
    ...(pode("reservas:editar") ? [{ para: "/listas/conferir", rotulo: "A conferir" }] : []),
  ];
  return (
    <div className="pagina">
      <AbasModulo itens={abas} rotulo="Listas de passageiros" />
      <Outlet />
    </div>
  );
}
