import { and, eq } from "drizzle-orm";
import { PONTOS_TODA_ILHA, textoDaPagina } from "@bybus/core";
import type { Db } from "./cliente.js";
import { bibliotecaPaginas } from "./schema.js";

/**
 * Manuais operacionais iniciais da Biblioteca.
 * Tudo vem de docs/conhecimento (e do plano da Fase 2): nada foi inventado. O que não está confirmado
 * aparece como "a confirmar". A semente é idempotente: cada página tem uma chave e só é criada se faltar
 * (páginas já editadas pela equipe nunca são sobrescritas).
 */
interface PaginaSemente {
  chave: string;
  paiChave?: string;
  titulo: string;
  ordem: number;
  conteudo: string;
}

const tabelaPontos = [
  "| Horário | Ponto | Referência |",
  "|---|---|---|",
  ...PONTOS_TODA_ILHA.map((p) => `| ${p.horario.replace(":", "h")} | ${p.nome}${p.ehTransfer ? " (transfer)" : ""} | ${p.endereco ?? ""} |`),
].join("\n");

export const PAGINAS_SEMENTE: PaginaSemente[] = [
  {
    chave: "manuais-operacionais",
    titulo: "Manuais operacionais",
    ordem: 10,
    conteudo: [
      "Procedimentos do dia a dia da operação da By Bus Turismo, reunidos a partir do Novo Manual do Atendente (2025/26), da lista de passageiros em uso e do plano da operação de Florianópolis.",
      "",
      "- **City Tour Toda Ilha (Florianópolis):** roteiro e pontos de embarque.",
      "- **BC By Bus (Balneário Camboriú):** roteiro e regras do passeio.",
      "- **Regras de embarque e confirmação de saída.**",
      "- **Fluxo da lista das 21h.**",
      "- **Reservas de Viator, Decolar e Civitatis.**",
      "- **Quiosque do Villa Romana Shopping.**",
      "",
      "> Aviso: onde aparecer **a confirmar**, a informação ainda não foi validada com o dono. Edite a página quando houver confirmação.",
    ].join("\n"),
  },
  {
    chave: "manual-city-tour-floripa",
    paiChave: "manuais-operacionais",
    titulo: "City Tour Toda Ilha (Florianópolis)",
    ordem: 10,
    conteudo: [
      "# City Tour Toda Ilha",
      "",
      "Carro-chefe da operação de Florianópolis.",
      "",
      "## O passeio",
      "- Dias: **terça a domingo**, das 8h às 16h30 (cerca de 8h30 de duração).",
      "- **6 paradas** e cerca de **110 km**.",
      "- Guia trilíngue e ônibus de dois andares com teto retrátil.",
      "- Variações no cadastro: Toda Ilha, Toda Ilha Norte e Toda Ilha Ano Novo (alta temporada, com horário e preço próprios).",
      "",
      "## Roteiro",
      "O site oficial cita a travessia da ilha com a **Lagoa da Conceição**, a **Joaquina**, a **Barra da Lagoa** e **Santo Antônio de Lisboa**.",
      "",
      "> A confirmar: a lista oficial das 6 paradas e a ordem delas.",
      "",
      "## Pontos de embarque",
      "Pontos oficiais cadastrados no sistema (tela **Passeios e pontos**, que é a fonte de verdade). Os quatro primeiros são de **transfer**, que possuem custo adicional para o passageiro.",
      "",
      tabelaPontos,
      "",
      "> A confirmar: coordenadas oficiais dos pontos. Os documentos do Drive citam \"12 pontos entre 6h50 e 10h\", enquanto o cadastro atual tem os pontos acima.",
      "",
      "## Lista de passageiros",
      "A lista impressa chama-se **Relação de passageiros** e tem cabeçalho com data, horário, roteiro e guia. A lista modelo tem 72 linhas: 1 a 57 no andar de cima e 58 a 72 no **piso baixo**.",
      "",
      "Fontes: `docs/conhecimento/produtos-e-site.md` e `docs/conhecimento/google-drive.md`.",
    ].join("\n"),
  },
  {
    chave: "manual-bc-by-bus",
    paiChave: "manuais-operacionais",
    titulo: "BC By Bus (Balneário Camboriú)",
    ordem: 20,
    conteudo: [
      "# BC By Bus — City Tour",
      "",
      "- Passeio da **tarde**, em ônibus aberto, com guia e áudio. Duração de cerca de **4h15**.",
      "- Embarque por volta das **14h55 / 15h**, na Av. Brasil.",
      "- Parada de **45 minutos** no Oceanic Aquarium; o ingresso do aquário é **à parte** (revenda do ingresso: combo ou antecipado).",
      "- Exclusivo para grupos: **BC By Bus Personalizado**, com no mínimo 20 pessoas (sob orçamento).",
      "",
      "## Regras do passeio com o Oceanic",
      "- **Proibido comer a bordo.**",
      "- Animais de estimação **até 25 kg**.",
      "- **Cinto de segurança obrigatório.**",
      "",
      "> A confirmar: pontos de embarque, horários e capacidade de Balneário Camboriú no cadastro do sistema; política de chuva e cancelamento (não encontrada em documento).",
      "",
      "Fontes: `docs/conhecimento/produtos-e-site.md` e `docs/conhecimento/google-drive.md`.",
    ].join("\n"),
  },
  {
    chave: "regras-embarque-confirmacao",
    paiChave: "manuais-operacionais",
    titulo: "Regras de embarque e confirmação de saída",
    ordem: 30,
    conteudo: [
      "# Regras de embarque e confirmação de saída",
      "",
      "## Mínimo para confirmar a saída",
      "- De **10 a 12 pessoas**: a saída é confirmada.",
      "- Com **8 ou 9**: a **supervisão decide**.",
      "",
      "No cadastro do City Tour Toda Ilha, o mínimo é 12 e o limite da supervisão é 10; a capacidade padrão é 73.",
      "",
      "## Cadastro de embarque do passageiro",
      "O formulário da Paytour pede nome completo, documento (RG, CPF ou passaporte) e **ponto de embarque**. O passageiro também pode informar a hospedagem pelo link de embarque, e o sistema sugere o ponto mais próximo.",
      "",
      "## Conferência",
      "Um colaborador revisa a fila **Conferência de embarque** (titular, canal, forma de pagamento, quantidade, ponto ou transfer e contato) e **confirma ou corrige** o ponto antes do fechamento. A conferência humana é obrigatória porque o passageiro pode escolher o ponto errado.",
      "",
      "## No embarque",
      "O guia usa o **modo embarque** e marca cada passageiro como embarcou, atrasado ou não veio.",
      "",
      "## Pagamento",
      "Na lista, a coluna **PG** indica pago ou a pagar no embarque (significado exato a confirmar). No quiosque, o pagamento em dinheiro é feito no próprio quiosque.",
      "",
      "Fontes: `docs/conhecimento/google-drive.md`, `docs/conhecimento/produtos-e-site.md` e `docs/produto/plano-fase-2.md`.",
    ].join("\n"),
  },
  {
    chave: "fluxo-lista-21h",
    paiChave: "manuais-operacionais",
    titulo: "Fluxo da lista das 21h",
    ordem: 40,
    conteudo: [
      "# Fluxo da lista das 21h",
      "",
      "Da venda ao embarque, no City Tour de Florianópolis:",
      "",
      "1. **Venda** (Paytour, Civitatis, Viator, Decolar): a reserva entra na saída do dia.",
      "2. **Logo após a venda:** voucher por e-mail e, quando o WhatsApp estiver ligado, também por WhatsApp. Se faltar ponto de embarque ou transfer, a mensagem leva o link de cadastro de embarque.",
      "3. **Passageiro abre o link** e informa o hotel ou pede transfer; o sistema sugere o ponto mais próximo.",
      "4. **Conferência:** colaborador confirma ou corrige.",
      "5. **Escala do mês:** guia e motorista definidos; troca de última hora só por **força maior**, com motivo registrado.",
      "6. **Véspera, às 21h:** fechamento da lista em **ordem de embarque**, com guia e motorista, pronta para o grupo do WhatsApp.",
      "7. **Depois do fechamento:** confirmação ao passageiro com dia, horário e ponto.",
      "8. **Embarque:** o guia marca embarcou ou não embarcou.",
      "9. **Pós-passeio:** pedido de avaliação, com destaque para o Tripadvisor.",
      "",
      "## Depois das 21h",
      "- Venda de última hora reabre a lista como **adendo** e a supervisão recebe o aviso; o fechamento pode ser refeito.",
      "- Reservas sem ponto ou não conferidas aparecem destacadas no topo da lista.",
      "- Enquanto o agendamento automático não estiver no ar, use o botão **Fechar lista agora**.",
      "",
      "## Grupo do WhatsApp",
      "O sistema gera o texto e um botão para abrir no WhatsApp, e a supervisão cola no grupo. O envio automático ao grupo depende da escolha do provedor de WhatsApp (a confirmar).",
      "",
      "Fonte: `docs/produto/plano-fase-2.md`.",
    ].join("\n"),
  },
  {
    chave: "reservas-otas",
    paiChave: "manuais-operacionais",
    titulo: "Reservas de Viator, Decolar e Civitatis",
    ordem: 50,
    conteudo: [
      "# Reservas de Viator, Decolar e Civitatis",
      "",
      "| Canal | Como a reserva chega | Comissão informada |",
      "|---|---|---|",
      "| Civitatis | Integrada à Paytour (entra sozinha) | 20% |",
      "| Tripadvisor / Viator | Aviso da Bókun por e-mail (código VIA-); cópia manual na Paytour | 25% |",
      "| Decolar | E-mail do sistema PAM para contatofbyb@; cópia manual na Paytour | 30% |",
      "",
      "## Regras",
      "- Reservas copiadas à mão na Paytour usam documento fictício (**1111** para a Viator e **2222** para a Decolar; o uso do 3333 é a confirmar) e o afiliado interno. A cópia da Viator não traz o código VIA- na observação; o sistema compara nome, data e categorias para evitar duplicidade.",
      "- O aviso da Viator/Bókun **não traz o ponto de embarque**; a Decolar também não traz horário nem ponto. Esses casos caem na conferência.",
      "- **Cancelamento e alteração na Decolar não têm aviso automático:** são conversas por e-mail com a Decolar, e o cancelamento é feito manualmente na saída.",
      "- **À noite:** pedir avaliações e **bloquear o dia seguinte nas OTAs**.",
      "",
      "> A confirmar: se o bloqueio de vagas será automático depois da integração (decisão do dono: parar as cópias manuais após a integração).",
      "",
      "Fontes: `docs/conhecimento/canais-e-integracoes.md`, `docs/conhecimento/google-drive.md` e `docs/conhecimento/produtos-e-site.md`.",
    ].join("\n"),
  },
  {
    chave: "quiosque-villa-romana",
    paiChave: "manuais-operacionais",
    titulo: "Quiosque do Villa Romana Shopping",
    ordem: 60,
    conteudo: [
      "# Quiosque do Villa Romana Shopping",
      "",
      "- Local: piso **L2** do Villa Romana Shopping (Florianópolis).",
      "- Funcionamento: **segunda a sábado, 10h às 22h**; **domingo, 14h às 20h**.",
      "- Pagamento em **dinheiro no quiosque**; há diferença de preço entre dinheiro e cartão ou Pix.",
      "- Cupons e afiliados valem pela Paytour; cortesias são controladas na Paytour.",
      "- O ponto de embarque do Villa Romana é no **ponto de táxi do shopping**.",
      "",
      "> A confirmar: política formal de idades, meia-entrada, gratuidades e cancelamento (não existe documento consolidado).",
      "",
      "Fonte: `docs/conhecimento/google-drive.md` e `docs/conhecimento/produtos-e-site.md`.",
    ].join("\n"),
  },
];

/** Cria as páginas-semente que ainda não existem. Pode rodar quantas vezes quiser. Devolve quantas criou. */
export async function semearBiblioteca(db: Db): Promise<number> {
  let criadas = 0;
  for (const p of PAGINAS_SEMENTE) {
    const [existe] = await db.select({ id: bibliotecaPaginas.id }).from(bibliotecaPaginas).where(eq(bibliotecaPaginas.chaveSemente, p.chave));
    if (existe) continue;
    let paiId: string | null = null;
    if (p.paiChave) {
      const [pai] = await db.select({ id: bibliotecaPaginas.id }).from(bibliotecaPaginas).where(and(eq(bibliotecaPaginas.chaveSemente, p.paiChave)));
      paiId = pai?.id ?? null;
    }
    const r = await db.insert(bibliotecaPaginas).values({ chaveSemente: p.chave, paiId, titulo: p.titulo, conteudo: p.conteudo, textoBusca: textoDaPagina(p.conteudo), ordem: p.ordem, acesso: "EQUIPE" }).onConflictDoNothing().returning({ id: bibliotecaPaginas.id });
    criadas += r.length;
  }
  return criadas;
}
