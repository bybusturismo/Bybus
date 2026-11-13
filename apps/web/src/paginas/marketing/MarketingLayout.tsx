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
  { para: "/marketing/retorno", rotulo: "Retorno e links" },
  { para: "/marketing/afiliados", rotulo: "Afiliados e QR codes" },
  { para: "/marketing/comissoes", rotulo: "Comissões de afiliados" },
  { para: "/marketing/mensagens", rotulo: "Mensagens automáticas" },
  { para: "/marketing/nps", rotulo: "NPS" },
  { para: "/marketing/relatorios", rotulo: "Relatórios" },
  { para: "/marketing/bio", rotulo: "Link na bio" },
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
