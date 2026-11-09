/** Regras puras das Conversas (WhatsApp e Instagram): etiquetas, respostas prontas e variáveis. */

export const ETIQUETAS_CONVERSA = ["DUVIDA", "POS_VENDA", "RECLAMACAO", "GRUPO", "ORCAMENTO"] as const;
export type EtiquetaConversa = (typeof ETIQUETAS_CONVERSA)[number];
export const ROTULO_ETIQUETA_CONVERSA: Record<EtiquetaConversa, string> = { DUVIDA: "Dúvida", POS_VENDA: "Pós-venda", RECLAMACAO: "Reclamação", GRUPO: "Grupo", ORCAMENTO: "Orçamento" };

export const IDIOMAS_RESPOSTA = ["PT", "EN", "ES"] as const;
export type IdiomaResposta = (typeof IDIOMAS_RESPOSTA)[number];

export const VARIAVEIS_RESPOSTA = ["nome", "passeio", "data", "ponto", "horario"] as const;
export type VariavelResposta = (typeof VARIAVEIS_RESPOSTA)[number];

export const ATALHO_RESPOSTA_REGEX = /^[a-z0-9][a-z0-9-]{0,29}$/;
export const normalizarAtalho = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/^\/+/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

/**
 * Troca {nome}, {passeio}, {data}, {ponto} e {horario} pelos valores conhecidos. O que não se sabe fica como {variavel}
 * no texto (o atendente completa antes de enviar) e vem em `faltando`. Outras chaves entre chaves não são tocadas.
 */
export function aplicarVariaveis(texto: string, valores: Partial<Record<VariavelResposta, string | null | undefined>>): { texto: string; faltando: VariavelResposta[] } {
  const faltando = new Set<VariavelResposta>();
  const saida = texto.replace(/\{(nome|passeio|data|ponto|horario)\}/g, (inteiro, k: VariavelResposta) => {
    const v = valores[k]?.trim();
    if (v) return v;
    faltando.add(k);
    return inteiro;
  });
  return { texto: saida, faltando: [...faltando] };
}

export interface RespostaInicial { atalho: string; titulo: string; idioma: IdiomaResposta; texto: string }

/**
 * Sugestões iniciais (as perguntas de todo dia). SÃO RASCUNHOS: nascem "não revisadas" e o dono precisa conferir os textos
 * (nenhuma política de chuva, de criança ou de cancelamento é afirmada aqui — as respostas só encaminham).
 */
export const RESPOSTAS_INICIAIS: RespostaInicial[] = [
  { atalho: "ponto", titulo: "Ponto de embarque", idioma: "PT", texto: "Olá, {nome}! Seu embarque no {passeio} em {data} será em {ponto}, às {horario}. Qualquer dúvida, é só chamar por aqui." },
  { atalho: "ponto", titulo: "Pickup point", idioma: "EN", texto: "Hello, {nome}! Your {passeio} on {data} departs from {ponto} at {horario}. Let us know if you have any questions." },
  { atalho: "ponto", titulo: "Punto de embarque", idioma: "ES", texto: "¡Hola, {nome}! Tu salida del {passeio} el {data} es en {ponto}, a las {horario}. Cualquier duda, escríbenos por aquí." },
  { atalho: "horario", titulo: "Horário da saída", idioma: "PT", texto: "Olá, {nome}! O {passeio} de {data} sai às {horario}, de {ponto}." },
  { atalho: "horario", titulo: "Departure time", idioma: "EN", texto: "Hello, {nome}! The {passeio} on {data} leaves at {horario} from {ponto}." },
  { atalho: "horario", titulo: "Horario de salida", idioma: "ES", texto: "¡Hola, {nome}! El {passeio} del {data} sale a las {horario} desde {ponto}." },
  { atalho: "chuva", titulo: "Chuva", idioma: "PT", texto: "Olá, {nome}! Vamos acompanhar a previsão do tempo. Se houver qualquer alteração na saída de {data}, avisamos você por aqui com antecedência." },
  { atalho: "chuva", titulo: "Rain", idioma: "EN", texto: "Hello, {nome}! We are keeping an eye on the weather forecast. If anything changes for the {data} departure, we will let you know here in advance." },
  { atalho: "chuva", titulo: "Lluvia", idioma: "ES", texto: "¡Hola, {nome}! Estamos atentos al pronóstico del tiempo. Si hay algún cambio en la salida del {data}, te avisamos por aquí con anticipación." },
  { atalho: "crianca", titulo: "Criança paga?", idioma: "PT", texto: "Olá, {nome}! A tarifa para crianças depende da idade e do passeio. Me diga a idade e eu confirmo o valor certo para o {passeio}." },
  { atalho: "crianca", titulo: "Do children pay?", idioma: "EN", texto: "Hello, {nome}! Child fares depend on the age and the tour. Tell me the child's age and I will confirm the right price for the {passeio}." },
  { atalho: "crianca", titulo: "¿Los niños pagan?", idioma: "ES", texto: "¡Hola, {nome}! La tarifa para niños depende de la edad y del paseo. Dime la edad y te confirmo el valor correcto para el {passeio}." },
  { atalho: "cancelamento", titulo: "Cancelamento", idioma: "PT", texto: "Olá, {nome}! Vou verificar as condições de cancelamento da sua reserva do {passeio} ({data}) e já te respondo por aqui." },
  { atalho: "cancelamento", titulo: "Cancellation", idioma: "EN", texto: "Hello, {nome}! I will check the cancellation terms for your {passeio} booking ({data}) and get back to you here shortly." },
  { atalho: "cancelamento", titulo: "Cancelación", idioma: "ES", texto: "¡Hola, {nome}! Voy a verificar las condiciones de cancelación de tu reserva del {passeio} ({data}) y te respondo por aquí enseguida." },
  { atalho: "voucher", titulo: "Voucher", idioma: "PT", texto: "Olá, {nome}! Vou reenviar o voucher do {passeio} ({data}). No dia, basta mostrá-lo ao guia no embarque." },
  { atalho: "voucher", titulo: "Voucher", idioma: "EN", texto: "Hello, {nome}! I will resend the voucher for the {passeio} ({data}). On the day, just show it to the guide when boarding." },
  { atalho: "voucher", titulo: "Voucher", idioma: "ES", texto: "¡Hola, {nome}! Te reenvío el voucher del {passeio} ({data}). El día de la salida, solo muéstraselo al guía al abordar." },
  // Respostas passadas pelo gerente (09/11/2026); EN/ES traduzidos a partir do PT, a revisar.
  { atalho: "bebida", titulo: "Comida e bebida", idioma: "PT", texto: "Olá, {nome}! Pedimos que não leve bebida alcoólica no passeio. O roteiro tem paradas estratégicas para você comer e beber nos locais de parada." },
  { atalho: "bebida", titulo: "Food and drinks", idioma: "EN", texto: "Hello, {nome}! Please do not bring alcoholic drinks on the tour. The route includes planned stops where you can eat and drink." },
  { atalho: "bebida", titulo: "Comida y bebida", idioma: "ES", texto: "¡Hola, {nome}! Te pedimos que no lleves bebidas alcohólicas al paseo. El recorrido tiene paradas estratégicas para comer y beber en los lugares de parada." },
  { atalho: "banheiro", titulo: "Banheiro no ônibus", idioma: "PT", texto: "Olá, {nome}! Pela legislação, ônibus urbano não tem banheiro, mas fazemos paradas estratégicas em parceiros que oferecem banheiro." },
  { atalho: "banheiro", titulo: "Restroom on the bus", idioma: "EN", texto: "Hello, {nome}! By law, city buses have no restroom, but we make planned stops at partners with restrooms." },
  { atalho: "banheiro", titulo: "Baño en el bus", idioma: "ES", texto: "¡Hola, {nome}! Por ley, los buses urbanos no tienen baño, pero hacemos paradas estratégicas en socios que ofrecen baño." },
  { atalho: "pet", titulo: "Aceita pet?", idioma: "PT", texto: "Olá, {nome}! Sim, o passeio é pet friendly para pets de pequeno e médio porte, sempre com o tutor. Recomendamos ir com mais de uma pessoa: em alguns locais, como restaurantes, o pet não entra, e assim vocês se revezam na companhia dele." },
  { atalho: "pet", titulo: "Pets allowed?", idioma: "EN", texto: "Hello, {nome}! Yes, the tour is pet friendly for small and medium pets, always with their owner. We recommend coming with someone else: pets are not allowed in some places, such as restaurants, so you can take turns keeping them company." },
  { atalho: "pet", titulo: "¿Se aceptan mascotas?", idioma: "ES", texto: "¡Hola, {nome}! Sí, el paseo es pet friendly para mascotas pequeñas y medianas, siempre con su tutor. Recomendamos ir con otra persona: en algunos lugares, como restaurantes, la mascota no puede entrar, y así se turnan para acompañarla." },
  { atalho: "duracao", titulo: "Duração do passeio", idioma: "PT", texto: "Olá, {nome}! Depende do passeio. O nosso roteiro principal, o City Tour Toda Ilha, dura aproximadamente 8h30." },
  { atalho: "duracao", titulo: "Tour length", idioma: "EN", texto: "Hello, {nome}! It depends on the tour. Our main route, the City Tour Toda Ilha, takes about 8.5 hours." },
  { atalho: "duracao", titulo: "Duración del paseo", idioma: "ES", texto: "¡Hola, {nome}! Depende del paseo. Nuestro recorrido principal, el City Tour Toda Ilha, dura aproximadamente 8 horas y media." },
];
