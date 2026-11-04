/** IA da demonstração: estado "ligada", uma avaliação fictícia dos 8 gestores e o Turistinha com resposta fixa. Nenhuma chamada externa. */
import { GESTORES, IDS_GESTORES, type IdGestor } from "@bybus/core";
import { NAO, achar, type Rotear } from "./comum";

type Nivel = "baixa" | "media" | "alta";
type StatusAcao = "SUGERIDA" | "APROVADA" | "CONCLUIDA" | "DESCARTADA";
interface Acao { id: string; avaliacaoId: string; titulo: string; detalhe: string; area: IdGestor; prioridade: Nivel; prazoDias: number | null; status: StatusAcao; decididaEm: string | null; observacao: string | null }
type Item = { titulo: string; detalhe: string; gravidade?: Nivel; impacto?: "baixo" | "medio" | "alto"; evidencia?: string };
type AcaoSug = { titulo: string; detalhe: string; prioridade: Nivel; prazo_dias: number; area: IdGestor };

export const RESPOSTA_TURISTINHA = "Esta é uma demonstração: o Turistinha não está conectado a nenhuma IA aqui e responde sempre com esta mesma frase. No sistema real ele consulta os números da operação (somente agregados) e responde em português.";
const ID_AVALIACAO = "av-demo-1";

interface Roteiro {
  alerta: string; achados: Item[]; vulnerabilidade: Item; oportunidade: Item; acao: Omit<AcaoSug, "area">;
  debate: Array<[IdGestor, "concordo" | "complemento" | "discordo", string]>;
}
const ROTEIROS: Record<IdGestor, Roteiro> = {
  comercial: {
    alerta: "A Paytour respondeu por 46% dos passageiros dos últimos 90 dias.",
    achados: [
      { titulo: "Venda concentrada na Paytour", detalhe: "Quase metade dos passageiros vem de um único canal, o que expõe a receita a mudanças de regra ou de comissão.", gravidade: "media", evidencia: "46% dos passageiros em 90 dias" },
      { titulo: "Reservas sem ponto de embarque", detalhe: "Parte das reservas das agências ainda chega sem ponto definido, o que atrasa a lista das 21h.", gravidade: "baixa" },
    ],
    vulnerabilidade: { titulo: "Dependência de um canal", detalhe: "Uma queda na Paytour derrubaria a ocupação da Toda Ilha em poucas semanas.", gravidade: "media" },
    oportunidade: { titulo: "Vender mais no quiosque", detalhe: "O balcão tem ocupação folgada nos dias de menor demanda.", impacto: "medio" },
    acao: { titulo: "Pedir o ponto de embarque no ato da reserva das agências", detalhe: "Ajustar o modelo de confirmação enviado aos parceiros para exigir o ponto.", prioridade: "media", prazo_dias: 15 },
    debate: [["marketing", "concordo", "Vale reforçar o canal próprio com campanhas de cupom para reduzir a dependência."], ["logistico", "complemento", "O ponto de embarque faltando também prejudica a ordem de embarque do ônibus."]],
  },
  logistico: {
    alerta: "3 saídas dos próximos 7 dias ainda estão sem guia escalado.",
    achados: [
      { titulo: "Saídas sem guia escalado", detalhe: "Há saídas previstas sem guia definido; a escala mensal ainda não foi publicada para todo o período.", gravidade: "alta", evidencia: "3 saídas em 7 dias" },
      { titulo: "Lista das 21h com pendências", detalhe: "Algumas reservas continuam sem conferência no fechamento do dia.", gravidade: "media" },
    ],
    vulnerabilidade: { titulo: "Troca de guia na véspera", detalhe: "Sem reserva de guias, uma falta de última hora cancela ou degrada o passeio.", gravidade: "media" },
    oportunidade: { titulo: "Escala publicada com antecedência", detalhe: "Publicar a escala com 15 dias de folga reduz trocas de última hora.", impacto: "alto" },
    acao: { titulo: "Publicar a escala dos próximos 15 dias", detalhe: "Fechar os guias das saídas sem escala e publicar para a equipe.", prioridade: "alta", prazo_dias: 3 },
    debate: [["rh", "concordo", "Também precisamos confirmar a disponibilidade dos guias reserva para a alta temporada."], ["frotas", "complemento", "A escala precisa cruzar com a disponibilidade dos veículos."]],
  },
  frotas: {
    alerta: "O CRLV de um ônibus vence em menos de 15 dias e uma van está imobilizada.",
    achados: [
      { titulo: "Documento vencendo", detalhe: "O licenciamento (CRLV) do ônibus de dois andares vence nas próximas semanas.", gravidade: "media", evidencia: "1 documento a vencer em 30 dias" },
      { titulo: "Van imobilizada", detalhe: "A van de fretamento está parada em manutenção corretiva e não pode ser escalada.", gravidade: "media" },
    ],
    vulnerabilidade: { titulo: "Pouca folga de frota", detalhe: "Com a van parada, um pedido de fretamento no fim de semana ficaria sem veículo.", gravidade: "media" },
    oportunidade: { titulo: "Consumo de combustível sob controle", detalhe: "O consumo médio está estável, sem alertas altos no mês.", impacto: "baixo" },
    acao: { titulo: "Renovar o CRLV do ônibus de dois andares", detalhe: "Pagar a taxa e protocolar a renovação antes do vencimento.", prioridade: "alta", prazo_dias: 7 },
    debate: [["administrativo", "concordo", "A taxa de licenciamento precisa entrar no contas a pagar desta semana."], ["comercial", "complemento", "Sem a van, não devemos prometer fretamentos para o fim de semana."]],
  },
  administrativo: {
    alerta: "Há 1 conta a pagar vencida e 4 linhas de extrato por conciliar.",
    achados: [
      { titulo: "Conta vencida", detalhe: "Uma taxa municipal está vencida; o valor é pequeno, mas gera multa.", gravidade: "media", evidencia: "1 conta vencida" },
      { titulo: "Extrato por conciliar", detalhe: "Há linhas pendentes de conciliação com sugestão de alta confiança já disponível.", gravidade: "baixa" },
    ],
    vulnerabilidade: { titulo: "Caixa depende dos repasses", detalhe: "A entrada de caixa do mês depende dos repasses de parceiros, que chegam em datas variáveis.", gravidade: "media" },
    oportunidade: { titulo: "Conciliar toda semana", detalhe: "Uma rotina semanal evita acúmulo e dá fluxo de caixa mais confiável.", impacto: "medio" },
    acao: { titulo: "Pagar a taxa municipal vencida e conciliar o extrato", detalhe: "Baixar a conta vencida e aceitar as sugestões de conciliação de alta confiança.", prioridade: "media", prazo_dias: 2 },
    debate: [["frotas", "concordo", "A licença de operação é exigida para a frota; vale resolver logo."], ["juridico", "complemento", "Convém guardar o comprovante do pagamento junto da pasta da licença."]],
  },
  marketing: {
    alerta: "A campanha de Instagram de Balneário Camboriú está abaixo da meta de reservas.",
    achados: [
      { titulo: "Campanha abaixo da meta", detalhe: "A campanha de Instagram em Balneário Camboriú atingiu menos da metade da meta de reservas.", gravidade: "baixa", evidencia: "17 reservas para meta de 40" },
      { titulo: "Boa nota média", detalhe: "As avaliações recentes têm média alta, boa matéria-prima para o conteúdo.", gravidade: "baixa" },
    ],
    vulnerabilidade: { titulo: "Atribuição incompleta", detalhe: "Sem cupom ou UTM em todas as campanhas, não é possível medir o retorno de cada uma.", gravidade: "media" },
    oportunidade: { titulo: "Usar avaliações no conteúdo", detalhe: "Depoimentos reais (com autorização) convertem bem em vídeo curto.", impacto: "medio" },
    acao: { titulo: "Colocar cupom ou UTM em toda campanha paga", detalhe: "Padronizar a nomenclatura para medir reservas por campanha.", prioridade: "media", prazo_dias: 20 },
    debate: [["comercial", "concordo", "Com cupom por campanha dá para saber onde vale investir mais."], ["tecnologia", "complemento", "A leitura automática do cupom na Paytour ainda está a confirmar."]],
  },
  juridico: {
    alerta: "Cadastur de um guia vence em menos de 30 dias (a confirmar na ficha).",
    achados: [
      { titulo: "Cadastur próximo do vencimento", detalhe: "O registro de um guia está perto do vencimento; guia sem cadastro ativo é risco regulatório.", gravidade: "media", evidencia: "1 cadastro em 30 dias" },
      { titulo: "Dados de passageiros", detalhe: "Documentos aparecem mascarados por padrão no manifesto, como manda a política de LGPD.", gravidade: "baixa" },
    ],
    vulnerabilidade: { titulo: "Licenças e autorizações", detalhe: "Licenças municipais e da ANTT precisam de calendário de renovação centralizado.", gravidade: "media" },
    oportunidade: { titulo: "Termo de aceite para fretamento", detalhe: "Um modelo de contrato padronizado acelera os pedidos de fretamento.", impacto: "medio" },
    acao: { titulo: "Renovar o Cadastur do guia com vencimento próximo", detalhe: "Avisar o guia e acompanhar a renovação até o vencimento.", prioridade: "media", prazo_dias: 20 },
    debate: [["rh", "concordo", "Entra no acompanhamento mensal de documentos da equipe."], ["frotas", "complemento", "O mesmo calendário pode cobrir as licenças dos veículos."]],
  },
  rh: {
    alerta: "Um motorista está com CNH vencida na ficha (dado fictício de demonstração).",
    achados: [
      { titulo: "CNH vencida na ficha", detalhe: "Um motorista consta com CNH vencida; ele não deve ser escalado até regularizar.", gravidade: "alta", evidencia: "1 ficha com CNH vencida" },
      { titulo: "Equipe enxuta na alta temporada", detalhe: "Poucos guias trilíngues para a alta temporada, com férias a combinar.", gravidade: "media" },
    ],
    vulnerabilidade: { titulo: "Dependência de poucos guias", detalhe: "Dois guias cobrem a maioria das saídas; uma ausência pesa muito.", gravidade: "media" },
    oportunidade: { titulo: "Formar guia reserva", detalhe: "Treinar um guia reserva dá folga à escala sem aumentar muito o custo fixo.", impacto: "alto" },
    acao: { titulo: "Regularizar a CNH do motorista antes de escalá-lo", detalhe: "Confirmar a renovação e atualizar a ficha antes de qualquer escala.", prioridade: "alta", prazo_dias: 5 },
    debate: [["logistico", "concordo", "Já bloqueamos o motorista na escala até regularizar."], ["administrativo", "discordo", "Contratar guia reserva agora pesa no caixa; melhor só na alta temporada."]],
  },
  tecnologia: {
    alerta: "A importação da Paytour está sendo feita manualmente em parte dos dias.",
    achados: [
      { titulo: "Importações manuais", detalhe: "Em alguns dias as reservas ainda entram por arquivo, o que aumenta o risco de atraso e duplicidade.", gravidade: "media" },
      { titulo: "Acessos com MFA", detalhe: "Perfis com acesso a dados sensíveis usam verificação em duas etapas, conforme a regra do sistema.", gravidade: "baixa" },
    ],
    vulnerabilidade: { titulo: "Integração depende de arquivo", detalhe: "Enquanto a integração direta não estiver ligada, a operação depende de alguém lembrar de importar.", gravidade: "media" },
    oportunidade: { titulo: "Ligar a integração direta com a Paytour", detalhe: "Importação automática reduz trabalho manual e erros.", impacto: "alto" },
    acao: { titulo: "Ligar a importação automática da Paytour no ambiente de testes", detalhe: "Validar com dados fictícios antes de pedir aprovação para produção.", prioridade: "media", prazo_dias: 30 },
    debate: [["comercial", "concordo", "Menos lançamento manual também reduz reserva sem ponto de embarque."], ["juridico", "complemento", "Só ligar em produção depois de aprovação do dono, com contrato revisado."]],
  },
};

let semeado = false;
const acoes: Acao[] = [];
let avaliacao: { dataRef: string; iniciadaEm: string; concluidaEm: string } | null = null;

function semear(hoje: string, agoraIso: string) {
  if (semeado) return;
  semeado = true;
  const fim = new Date(Date.parse(agoraIso) - 3_600_000).toISOString();
  avaliacao = { dataRef: hoje, iniciadaEm: new Date(Date.parse(fim) - 240_000).toISOString(), concluidaEm: fim };
  for (const g of IDS_GESTORES) {
    const a = ROTEIROS[g].acao;
    acoes.push({ id: `ac-${g}`, avaliacaoId: ID_AVALIACAO, titulo: a.titulo, detalhe: a.detalhe, area: g, prioridade: a.prioridade, prazoDias: a.prazo_dias, status: "SUGERIDA", decididaEm: null, observacao: null });
  }
}

const contagem = () => {
  const o: Partial<Record<StatusAcao, number>> = {};
  for (const a of acoes) o[a.status] = (o[a.status] ?? 0) + 1;
  return o;
};
const resumoTexto = "Operação saudável, com três pontos de atenção: escala dos próximos dias sem guias definidos, documentos de frota e equipe a vencer e dependência de um canal de venda. Nada crítico para hoje; as ações sugeridas abaixo organizam as próximas duas semanas. (Avaliação fictícia de demonstração.)";

function retratos() {
  return Object.fromEntries(IDS_GESTORES.map((g) => [g, { alertas: [ROTEIROS[g].alerta] }])) as Record<IdGestor, { alertas: string[] }>;
}
function resumoAvaliacao() {
  return {
    id: ID_AVALIACAO, dataRef: avaliacao!.dataRef, origem: "AUTOMATICA" as const, status: "CONCLUIDA" as const, modelo: "modelo-demonstracao", modeloSintese: "modelo-demonstracao-sintese",
    iniciadaEm: avaliacao!.iniciadaEm, concluidaEm: avaliacao!.concluidaEm, erro: null, custoUsd: 0.42, resumo: resumoTexto, acoes: contagem(),
  };
}
function detalheAvaliacao() {
  const { resumo: _r, acoes: _a, ...base } = resumoAvaliacao();
  const sug = (g: IdGestor): AcaoSug => ({ ...ROTEIROS[g].acao, area: g });
  const pareceres = [
    ...IDS_GESTORES.map((g) => ({ gestor: g, rodada: 1 as const, conteudo: { achados: ROTEIROS[g].achados, vulnerabilidades: [ROTEIROS[g].vulnerabilidade], oportunidades: [ROTEIROS[g].oportunidade], acoes_sugeridas: [sug(g)] } })),
    ...IDS_GESTORES.map((g) => ({
      gestor: g, rodada: 2 as const,
      conteudo: {
        comentarios: ROTEIROS[g].debate.map(([gestor, tipo, texto]) => ({ gestor, tipo, texto })),
        riscos_cruzados: g === "logistico" ? [{ titulo: "Escala x frota x documentos", detalhe: "Guia sem escala, van parada e documentos a vencer se acumulam na mesma semana e reduzem a folga operacional.", areas: ["logistico", "frotas", "rh"] as IdGestor[] }]
          : g === "administrativo" ? [{ titulo: "Caixa e renovações", detalhe: "Renovações de licenças e do CRLV caem no mesmo mês dos repasses mais lentos.", areas: ["administrativo", "frotas", "juridico"] as IdGestor[] }] : [],
        acoes_sugeridas: [] as AcaoSug[],
      },
    })),
  ];
  return {
    ...base, retratos: retratos(), pareceres, acoes: [...acoes],
    sintese: {
      resumo: resumoTexto,
      vulnerabilidades: [
        { titulo: "Pouca folga operacional na semana", detalhe: "Escala incompleta, van imobilizada e documentos a vencer ao mesmo tempo.", gravidade: "media" as Nivel },
        { titulo: "Dependência da Paytour", detalhe: "Cerca de metade dos passageiros vem de um só canal.", gravidade: "media" as Nivel },
      ],
      oportunidades: [
        { titulo: "Publicar a escala com 15 dias de antecedência", detalhe: "Reduz trocas de última hora e dá previsibilidade à equipe.", impacto: "alto" as const },
        { titulo: "Ligar a importação automática da Paytour", detalhe: "Menos trabalho manual e menos reservas sem ponto de embarque.", impacto: "alto" as const },
      ],
      acoes_sugeridas: IDS_GESTORES.map(sug),
      pontos_de_discordia: ["Contratar guia reserva agora ou só na alta temporada (administrativo e RH divergem)."],
    },
  };
}

export const rotearIa: Rotear = (ctx, metodo, caminho, q, c) => {
  if (!caminho.startsWith("/api/ia/")) return NAO;
  semear(ctx.dataMais(0), ctx.agoraIso());
  let m: RegExpMatchArray | null;
  const r = (re: RegExp) => (m = caminho.match(re));
  const usar = () => ctx.exigir("ia:usar");
  const gestores = () => ctx.exigir("ia:gestores");
  const podeGestores = () => { try { ctx.exigir("ia:gestores"); return true; } catch { return false; } };

  if (metodo === "GET" && caminho === "/api/ia/estado") {
    usar();
    const base = { ligada: true, assistente: true, gestores: podeGestores() };
    if (!base.gestores) return base;
    return { ...base, modelo: "modelo-demonstracao", modeloSintese: "modelo-demonstracao-sintese", limiteMesUsd: 50, gastoMesUsd: 3.42, avaliacaoDiaria: true, horario: "06:00", emAndamento: false };
  }
  if (metodo === "POST" && caminho === "/api/ia/assistente") {
    usar();
    return { resposta: RESPOSTA_TURISTINHA, ferramentas: [], custoUsd: 0 };
  }
  if (metodo === "GET" && caminho === "/api/ia/gestores") { gestores(); return GESTORES.map((g) => ({ id: g.id, nome: g.nome, descricao: g.descricao })); }
  if (metodo === "GET" && caminho === "/api/ia/retratos") { gestores(); return { data: avaliacao!.dataRef, retratos: retratos() }; }
  if (metodo === "GET" && caminho === "/api/ia/avaliacoes") { gestores(); return [resumoAvaliacao()]; }
  if (metodo === "GET" && r(/^\/api\/ia\/avaliacoes\/([^/]+)$/)) {
    gestores();
    if (m![1] !== ID_AVALIACAO) throw ctx.erro(404, "NAO_ENCONTRADO", "Avaliação não encontrada.");
    return detalheAvaliacao();
  }
  // Na demonstração não há nova rodada: devolve a avaliação fictícia já concluída.
  if (metodo === "POST" && caminho === "/api/ia/avaliacoes") { gestores(); return { id: ID_AVALIACAO }; }
  if (metodo === "GET" && caminho === "/api/ia/acoes") {
    gestores();
    return acoes.filter((a) => !q.get("status") || a.status === q.get("status"));
  }
  if (metodo === "PATCH" && r(/^\/api\/ia\/acoes\/([^/]+)$/)) {
    gestores();
    const a = achar(acoes, m![1]!, ctx, "Ação");
    if (c.status) { a.status = c.status; a.decididaEm = c.status === "SUGERIDA" ? null : ctx.agoraIso(); }
    if ("observacao" in c) a.observacao = c.observacao ?? null;
    ctx.auditar("IA_ACAO_DECIDIDA", "ia_acao", a.id, { status: a.status });
    return a;
  }
  throw ctx.erro(404, "NAO_ENCONTRADO", "Função não disponível na demonstração.");
};
