import { Link, useParams } from "react-router-dom";
import { Vazio } from "../componentes/Estados";

interface ModuloPlanejado {
  titulo: string;
  area: string;
  objetivo: string;
  funcoes: string[];
  depende?: string;
}

/** Módulos que aparecem no menu e entram nas próximas fases (ver docs/produto/plano-fase-2.md e roadmap.md). */
export const MODULOS_PLANEJADOS: Record<string, ModuloPlanejado> = {
  passageiros: {
    titulo: "Passageiros e clientes",
    area: "Cadastros",
    objetivo: "Cadastro único de quem já viajou, com origem (país, estado, cidade) e histórico de passeios.",
    funcoes: ["Busca por nome, documento ou telefone", "Histórico de reservas e canais", "Consentimento de mensagens (LGPD)", "Exclusão/anonimização a pedido do titular"],
  },
  empresas: {
    titulo: "Empresas parceiras",
    area: "Cadastros",
    objetivo: "Empresas de fretamento, publicidade e fornecedores (ex.: Grupo Oceanic).",
    funcoes: ["Contratos e contatos", "Serviços prestados e faturamento"],
  },
};

export function EmBreve() {
  const { modulo = "" } = useParams();
  const m = MODULOS_PLANEJADOS[modulo];
  if (!m) return <Vazio titulo="Módulo não encontrado." />;
  return (
    <div className="pagina pagina--estreita">
      <nav className="migalhas" aria-label="Você está em">
        {m.area} › {m.titulo}
      </nav>
      <div className="pagina__cabecalho">
        <div>
          <h1>
            {m.titulo} <span className="etiqueta etiqueta--neutra">em breve</span>
          </h1>
          <p className="pagina__descricao">{m.objetivo}</p>
        </div>
      </div>
      <section className="cartao" aria-labelledby="titulo-funcoes">
        <h2 id="titulo-funcoes">O que este módulo vai fazer</h2>
        <ul className="lista-planejada">
          {m.funcoes.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        {m.depende && (
          <p className="texto-fraco">
            <strong>Depende de:</strong> {m.depende}
          </p>
        )}
        <p className="texto-fraco">
          O plano completo está no documento “Plano de ação — Fase 2”. <Link to="/saidas">Voltar para Saídas</Link>
        </p>
      </section>
    </div>
  );
}
