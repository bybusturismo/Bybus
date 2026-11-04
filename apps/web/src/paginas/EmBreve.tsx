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
  rastreamento: {
    titulo: "Rastreamento",
    area: "Passeios",
    objetivo: "Ver o ônibus no mapa e avisar o passageiro quando ele estiver chegando ao ponto, como nos aplicativos de transporte.",
    funcoes: ["Posição do ônibus em tempo real", "Previsão de chegada em cada ponto de embarque", "Link de acompanhamento enviado pelo WhatsApp na manhã do passeio", "Avisos de 10 e 5 minutos e “o ônibus está no ponto”"],
    depende: "API ou webhook de posição do rastreador (Grupo Khronos) ou aplicativo de GPS no celular do motorista; coordenadas oficiais dos pontos.",
  },
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
  "contas-a-pagar": {
    titulo: "Contas a pagar",
    area: "Administrativo",
    objetivo: "Controle de despesas por praça, linha de negócio e veículo.",
    funcoes: ["Lançamentos com vencimento e categoria", "Pagamento de guias, motoristas e parceiros", "Manutenção e abastecimento da frota", "Alertas de vencimento"],
  },
  "contas-a-receber": {
    titulo: "Contas a receber",
    area: "Administrativo",
    objetivo: "O que cada canal deve repassar (Paytour, OTAs, fretamentos, publicidade).",
    funcoes: ["Repasses por canal com conciliação", "Recebimentos de fretamento e publicidade", "Fluxo de caixa"],
  },
  cartoes: {
    titulo: "Cartões de crédito",
    area: "Administrativo",
    objetivo: "Gastos e faturas dos cartões da empresa.",
    funcoes: ["Lançamentos por cartão e categoria", "Fechamento e vencimento da fatura", "Conferência com o extrato"],
  },
  frota: {
    titulo: "Frota e manutenção",
    area: "Administrativo",
    objetivo: "Ônibus, trenzinho e van: documentos, manutenção e quilometragem.",
    funcoes: ["Documentos com alerta de vencimento", "Manutenção preventiva por km/tempo", "Abastecimento e custo por veículo", "Checklist do motorista"],
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
