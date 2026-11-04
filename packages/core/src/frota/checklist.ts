export interface ItemChecklistPadrao {
  grupo: string;
  descricao: string;
  /** Item de segurança: "não ok" imobiliza o veículo até a equipe liberar. */
  critico: boolean;
}

/**
 * Itens iniciais do checklist diário, a partir da planilha "chekin list" e da Cartilha do Motorista
 * (docs/conhecimento/frota.md). A equipe edita a lista pela tela (itens configuráveis).
 */
export const ITENS_CHECKLIST_PADRAO: ItemChecklistPadrao[] = [
  { grupo: "Emergência", descricao: "Extintor no prazo e fixo", critico: true },
  { grupo: "Emergência", descricao: "Kit de primeiros socorros", critico: false },
  { grupo: "Emergência", descricao: "Macaco, chave de roda e calço", critico: false },
  { grupo: "Emergência", descricao: "Triângulo de sinalização", critico: false },
  { grupo: "Emergência", descricao: "Martelo quebra-vidro e saídas de emergência livres", critico: true },
  { grupo: "Exterior", descricao: "Pneus calibrados e sem danos visíveis", critico: true },
  { grupo: "Exterior", descricao: "Faróis, lanternas, setas e luz de freio", critico: true },
  { grupo: "Exterior", descricao: "Vidros, espelhos e limpador de para-brisa", critico: false },
  { grupo: "Exterior", descricao: "Lataria sem avarias novas", critico: false },
  { grupo: "Interior", descricao: "Cintos e bancos em ordem", critico: false },
  { grupo: "Interior", descricao: "Limpeza do interior", critico: false },
  { grupo: "Interior", descricao: "Ar-condicionado e ventilação", critico: false },
  { grupo: "Interior", descricao: "Sistema de som/microfone do guia", critico: false },
  { grupo: "Mecânica", descricao: "Nível de óleo do motor", critico: true },
  { grupo: "Mecânica", descricao: "Água do radiador / arrefecimento", critico: true },
  { grupo: "Mecânica", descricao: "Freios e freio de estacionamento", critico: true },
  { grupo: "Mecânica", descricao: "Sem vazamentos (óleo, água, ar)", critico: true },
  { grupo: "Mecânica", descricao: "Painel sem luzes de alerta acesas", critico: false },
  { grupo: "Documentação", descricao: "CRLV e licenças a bordo", critico: false },
  { grupo: "Documentação", descricao: "Cronotacógrafo/tacógrafo funcionando", critico: false },
];

export interface RespostaChecklist {
  itemId: string;
  descricao: string;
  critico: boolean;
  ok: boolean;
  observacao?: string | null;
}

export interface ResumoChecklist {
  total: number;
  naoOk: number;
  criticosNaoOk: number;
  /** Aprovado = nenhum item crítico com problema. */
  aprovado: boolean;
}

export function resumirChecklist(respostas: RespostaChecklist[]): ResumoChecklist {
  const naoOk = respostas.filter((r) => !r.ok);
  const criticosNaoOk = naoOk.filter((r) => r.critico).length;
  return { total: respostas.length, naoOk: naoOk.length, criticosNaoOk, aprovado: criticosNaoOk === 0 };
}
