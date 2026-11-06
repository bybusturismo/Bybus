import { Outlet } from "react-router-dom";
import { AbasModulo } from "../../componentes/Pagina";

const ABAS = [
  { para: "/marketing/canais", rotulo: "Vendas por canal" },
  { para: "/marketing/origem", rotulo: "Origem dos clientes" },
  { para: "/marketing/campanhas", rotulo: "Campanhas" },
  { para: "/marketing/conteudo", rotulo: "Calendário de conteúdo" },
  { para: "/marketing/instagram", rotulo: "Instagram" },
  { para: "/marketing/banco-midias", rotulo: "Banco de mídias" },
  { para: "/marketing/avaliacoes", rotulo: "Avaliações" },
  { para: "/marketing/afiliados", rotulo: "Afiliados e QR codes" },
];

/** Moldura do Marketing: abas iguais às do Financeiro e da Frota. */
export function MarketingLayout() {
  return (
    <div className="pagina">
      <AbasModulo itens={ABAS} rotulo="Marketing" />
      <Outlet />
    </div>
  );
}
