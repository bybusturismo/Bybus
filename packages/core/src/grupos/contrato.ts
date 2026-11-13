import { valorPorExtenso } from "./grupos.js";

/**
 * Contrato padrão de grupo fechado (13/11/2026), montado a partir do modelo redigido pelo dono (passeio pedagógico,
 * 16 cláusulas) e das regras do negócio: sinal para reservar a data, saldo até o passeio, antecipado não devolvido em
 * cancelamento (remarcação ou crédito em até 12 meses, a critério da By Bus). Texto-base sujeito à revisão da Diretoria
 * e de advogado (a confirmar). "**texto**" marca negrito.
 */

export interface DadosEmpresaContrato {
  razaoSocial: string;
  cnpj: string;
  endereco: string;
  cidadeForo: string;
  assinanteNome: string | null;
  assinanteCargo: string | null;
}

export interface DadosGrupoContrato {
  nome: string;
  estilo: "ESCOLA" | "EMPRESA" | "EXCURSAO" | "EVENTO" | "OUTRO";
  razaoSocial: string | null;
  cnpj: string | null;
  endereco: string | null;
  representanteNome: string | null;
  representanteCargo: string | null;
  dataPasseio: string | null;
  horarioInicio: string | null;
  localInicio: string | null;
  roteiro: string | null;
  duracaoTexto: string | null;
  almoco: boolean;
  localAlmoco: string | null;
  pessoas: number | null;
  pessoasMinimo: number | null;
  cortesias: number;
  valorPorPessoaCentavos: number | null;
  valorTotalCentavos: number | null;
  sinalPercentual: number;
  /** Vencimento do sinal (da cobrança gerada), se houver. */
  vencimentoSinal: string | null;
  /** Data limite para a lista final de participantes. */
  prazoLista: string | null;
}

export type BlocoContrato =
  | { tipo: "titulo"; texto: string }
  | { tipo: "clausula"; texto: string }
  | { tipo: "paragrafo"; texto: string }
  | { tipo: "assinaturas"; partes: Array<{ papel: string; nome: string; linhas: string[] }> };

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const dataBr = (iso: string) => iso.split("-").reverse().join("/");
export const dataPorExtenso = (iso: string) => { const [a, m, d] = iso.split("-").map(Number) as [number, number, number]; return `${d} de ${MESES[m - 1]} de ${a}`; };
const reais = (c: number) => `R$ ${Math.floor(c / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${String(c % 100).padStart(2, "0")}`;
const comExtenso = (c: number) => `**${reais(c)} (${valorPorExtenso(c)})**`;
const numeroExtenso = (n: number) => `${String(n).padStart(2, "0")} (${valorPorExtenso(n * 100).replace(/ reais?$/, "").replace(/^um$/, "um")})`;
const AFAZER = "____________";

/** Quem participa: alunos para escola; pessoas/participantes para os demais. */
function quem(estilo: DadosGrupoContrato["estilo"]) {
  return estilo === "ESCOLA" ? { plural: "alunos", porPessoa: "por aluno", acompanhantes: "professores e/ou monitores" } : { plural: "participantes", porPessoa: "por participante", acompanhantes: "coordenadores e/ou responsáveis" };
}

export function montarContratoGrupo(g: DadosGrupoContrato, e: DadosEmpresaContrato, emitidoEm: string): BlocoContrato[] {
  const q = quem(g.estilo);
  const escola = g.estilo === "ESCOLA";
  const servico = escola ? "PASSEIO PEDAGÓGICO" : "PASSEIO TURÍSTICO EM GRUPO";
  const contratante = g.razaoSocial || g.nome;
  const minimo = g.pessoasMinimo ?? null;
  const vpp = g.valorPorPessoaCentavos;
  const valorMinimo = vpp != null && minimo ? vpp * minimo : null;
  const total = g.valorTotalCentavos ?? valorMinimo ?? null;
  const baseSinal = valorMinimo ?? total;
  const sinal = baseSinal != null ? Math.floor((baseSinal * g.sinalPercentual) / 100) : null;
  const data = g.dataPasseio ? `**${dataBr(g.dataPasseio)}**` : AFAZER;
  const roteiro = (g.roteiro ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const b: BlocoContrato[] = [];
  const cl = (t: string) => b.push({ tipo: "clausula", texto: t });
  const p = (t: string) => b.push({ tipo: "paragrafo", texto: t });

  b.push({ tipo: "titulo", texto: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS – ${servico}` });
  p(`**CONTRATANTE:** ${contratante}${g.cnpj ? `, inscrita no CNPJ nº ${g.cnpj}` : ""}${g.endereco ? `, com sede em ${g.endereco}` : ""}, neste ato representada por ${g.representanteNome ? `${g.representanteNome}${g.representanteCargo ? `, ${g.representanteCargo}` : ""}` : "seu responsável legal"}.`);
  p(`**CONTRATADA:** ${e.razaoSocial.toUpperCase()}, pessoa jurídica de direito privado, inscrita no CNPJ nº ${e.cnpj}, com sede na ${e.endereco}, neste ato representada por ${e.assinanteNome ? `${e.assinanteNome}${e.assinanteCargo ? `, ${e.assinanteCargo}` : ""}` : "seu responsável legal"}.`);
  p(`As partes acima identificadas têm, entre si, justo e contratado o presente Contrato de Prestação de Serviços – ${escola ? "Passeio Pedagógico" : "Passeio Turístico em Grupo"}, mediante as cláusulas e condições seguintes.`);

  cl("CLÁUSULA 1ª – DO OBJETO");
  p(`1.1. O presente contrato tem por objeto a prestação, pela CONTRATADA, de serviço de transporte turístico, acompanhamento e execução de ${escola ? "passeio pedagógico destinado aos alunos, professores e/ou monitores" : "passeio turístico destinado aos participantes"} da CONTRATANTE, conforme data, roteiro, horários, condições e valores estabelecidos neste instrumento.`);
  p("1.2. Integram o objeto deste contrato exclusivamente os serviços expressamente previstos neste instrumento.");
  p("1.3. Não estão incluídos no valor contratado os ingressos, alimentação, bebidas, despesas pessoais, taxas ou quaisquer outros serviços ou produtos que não estejam expressamente previstos como responsabilidade da CONTRATADA.");

  cl("CLÁUSULA 2ª – DA DATA, HORÁRIOS E DO ROTEIRO");
  p(`2.1. O passeio será realizado no dia ${data}${g.horarioInicio ? `, com início previsto para aproximadamente **${g.horarioInicio.replace(":", "h")}**` : ""}.`);
  p(`2.2. O passeio terá início ${g.localInicio ? `em ${g.localInicio}` : "em local previamente acordado entre as partes"}, em horário previamente acordado entre as partes.`);
  if (roteiro.length) {
    p("2.3. O roteiro contratado compreenderá:");
    roteiro.forEach((l, i) => p(/^[a-z]\)/i.test(l) ? l : `${String.fromCharCode(97 + i)}) ${l}`));
  } else p("2.3. O roteiro contratado é o acordado entre as partes e anexo a este contrato.");
  if (g.duracaoTexto) p(`2.4. A duração total do passeio é estimada em aproximadamente **${g.duracaoTexto}**, podendo variar em razão de trânsito, embarques e desembarques, tempo de permanência nas paradas, condições de acesso aos locais visitados e demais fatores operacionais.`);
  p(`2.${g.duracaoTexto ? 5 : 4}. Os horários previstos neste contrato são estimados e poderão sofrer pequenos ajustes necessários à segurança dos passageiros, à operação do serviço, às condições de trânsito, ao funcionamento dos locais visitados ou a outros fatores externos.`);

  cl(`CLÁUSULA 3ª – DO VALOR${minimo ? ` E DA QUANTIDADE MÍNIMA DE ${q.plural.toUpperCase()}` : ""}`);
  if (vpp != null) {
    p(`3.1. Pela prestação dos serviços contratados, a CONTRATANTE pagará à CONTRATADA o valor de ${comExtenso(vpp)} ${q.porPessoa}.`);
    if (minimo && valorMinimo != null) {
      p(`3.2. Fica estabelecida a quantidade mínima de **${numeroExtenso(minimo)} ${q.plural}** para a realização do passeio.`);
      if (escola) p("3.3. Para fins de cumprimento da quantidade mínima, serão considerados exclusivamente os alunos. Professores, monitores e demais acompanhantes não serão contabilizados.");
      p(`3.${escola ? 4 : 3}. Considerando a quantidade mínima, o valor mínimo do serviço será de ${comExtenso(valorMinimo)}.`);
      p(`3.${escola ? 5 : 4}. Caso a quantidade final de ${q.plural} seja superior à mínima, será acrescido o valor de ${comExtenso(vpp)} ${q.porPessoa} adicional; caso seja inferior, permanecerá devido o valor mínimo contratado.`);
    } else if (total != null && g.pessoas) {
      p(`3.2. Considerando ${g.pessoas} ${q.plural}, o valor total do serviço é de ${comExtenso(total)}, ajustado conforme a quantidade final informada.`);
    }
  } else if (total != null) p(`3.1. Pela prestação dos serviços contratados, a CONTRATANTE pagará à CONTRATADA o valor total de ${comExtenso(total)}.`);
  else p(`3.1. Pela prestação dos serviços contratados, a CONTRATANTE pagará à CONTRATADA o valor de R$ ${AFAZER}.`);
  if (g.cortesias > 0) {
    p(`3.${escola ? 6 : 5}. A CONTRATADA concederá à CONTRATANTE **${numeroExtenso(g.cortesias)} vaga(s) de ${q.acompanhantes} como cortesia**, sem cobrança pelo transporte e participação no passeio, que não serão contabilizadas para a quantidade mínima e não abrangem ingressos, alimentação, bebidas, taxas ou outras despesas cobradas por terceiros.`);
    p(`3.${escola ? 7 : 6}. A participação de ${q.acompanhantes} além das cortesias ficará sujeita à disponibilidade de lugares e às condições previamente acordadas entre as partes.`);
  }
  if (g.prazoLista) p(`3.${escola ? 8 : 7}. A quantidade final de participantes deverá ser informada pela CONTRATANTE até **${dataBr(g.prazoLista)}**.`);

  cl("CLÁUSULA 4ª – DOS SERVIÇOS DE TERCEIROS E DA ALIMENTAÇÃO");
  p(g.almoco ? `4.1. O roteiro prevê parada para almoço${g.localAlmoco ? ` em ${g.localAlmoco}` : ""}. Os valores de alimentação não estão incluídos no valor do passeio e deverão ser pagos diretamente ao estabelecimento.` : "4.1. Os valores de alimentação não estão incluídos no valor do passeio e, quando houver, deverão ser pagos diretamente ao estabelecimento.");
  p("4.2. Ingressos, agendamentos e autorizações de locais visitados, quando exigidos, são de responsabilidade da CONTRATANTE, não estando incluídos no preço contratado, salvo previsão expressa em contrário.");
  p("4.3. A CONTRATADA não será responsável pelo recebimento, cobrança, repasse, administração ou restituição dos valores de serviços fornecidos diretamente por terceiros, nem por alterações de preços, filas, horários, restrições de acesso ou suspensão de visitação determinadas por eles.");

  cl("CLÁUSULA 5ª – DA RESERVA, DO PAGAMENTO E DO INADIMPLEMENTO");
  p(`5.1. A assinatura deste contrato formaliza a contratação e garante a reserva da data de ${data}, bem como a disponibilização de veículo, equipe e estrutura operacional necessários à execução dos serviços.`);
  if (sinal != null && g.sinalPercentual > 0 && g.sinalPercentual < 100) {
    p(`5.2. A CONTRATANTE deverá efetuar o pagamento correspondente a **${g.sinalPercentual}% do valor ${valorMinimo != null ? "mínimo " : ""}contratado**, equivalente a ${comExtenso(sinal)}, até **${g.vencimentoSinal ? dataBr(g.vencimentoSinal) : AFAZER}**.`);
    p("5.3. O saldo remanescente, considerando eventual diferença decorrente da quantidade final de participantes, deverá ser pago até o dia da realização do serviço, antes do início do passeio.");
  } else p(`5.2. O pagamento ${g.sinalPercentual >= 100 ? "integral" : ""} deverá ser efetuado até ${g.vencimentoSinal ? `**${dataBr(g.vencimentoSinal)}**` : "a data acordada entre as partes"}.`.replace("  ", " "));
  p("5.4. Os pagamentos deverão ser realizados à CONTRATADA por PIX, transferência bancária ou outro meio previamente acordado.");
  p("5.5. O não pagamento da primeira parcela no prazo estabelecido caracterizará inadimplemento contratual, podendo a CONTRATADA considerar a contratação cancelada e liberar a data, sem prejuízo da cobrança do valor devido.");
  p("5.6. O não pagamento do débito no vencimento caracterizará mora da CONTRATANTE, podendo incidir os encargos legalmente cabíveis e as despesas comprovadamente decorrentes de cobrança. O pagamento posterior não implicará reativação automática da reserva, ficando a retomada condicionada à disponibilidade da CONTRATADA.");

  cl("CLÁUSULA 6ª – DAS RESPONSABILIDADES DA CONTRATADA");
  p("6.1. São responsabilidades da CONTRATADA: a) disponibilizar veículo devidamente regularizado; b) disponibilizar motorista habilitado e equipe necessária à execução do serviço; c) disponibilizar guia de turismo para acompanhamento do grupo; d) executar o roteiro contratado, observadas as condições deste contrato; e) adotar as medidas razoáveis de segurança relacionadas à operação do veículo e à execução de suas atribuições.");
  p("6.2. A responsabilidade da CONTRATADA limita-se aos serviços contratados, não abrangendo a administração, funcionamento, cobrança ou organização interna dos locais visitados.");

  cl("CLÁUSULA 7ª – DAS RESPONSABILIDADES DA CONTRATANTE");
  p(`7.1. São responsabilidades da CONTRATANTE: a) responsabilizar-se pelo acompanhamento, supervisão e disciplina dos participantes durante todo o passeio; b) disponibilizar ${q.acompanhantes} em quantidade suficiente; c) cumprir os horários estabelecidos; d) orientar os participantes quanto às regras de comportamento e segurança; e) informar previamente qualquer necessidade específica do grupo; f) providenciar e custear ingressos, autorizações e agendamentos de terceiros que sejam de sua responsabilidade; g) fornecer informações verdadeiras e atualizadas dos participantes; h) responsabilizar-se pelos danos comprovadamente causados ao veículo ou equipamentos da CONTRATADA por participantes do grupo.`);

  cl("CLÁUSULA 8ª – DA LISTA DE PARTICIPANTES");
  p(`8.1. A CONTRATANTE deverá encaminhar à CONTRATADA${g.prazoLista ? `, até **${dataBr(g.prazoLista)}**,` : ""} a relação definitiva dos participantes, com os nomes completos e, quando necessário para a execução do serviço e para a fiscalização, os respectivos documentos de identificação.`);
  p("8.2. A CONTRATANTE será responsável pela veracidade, legitimidade e atualização das informações fornecidas. Alteração posterior na quantidade de participantes ficará sujeita à disponibilidade operacional da CONTRATADA.");

  cl("CLÁUSULA 9ª – DA PROTEÇÃO DE DADOS PESSOAIS");
  p("9.1. Os dados pessoais fornecidos pela CONTRATANTE serão utilizados pela CONTRATADA exclusivamente na medida necessária à organização, execução, segurança, identificação dos participantes e comprovação dos serviços contratados, nos termos da Lei nº 13.709/2018 (LGPD).");
  p("9.2. A CONTRATANTE declara possuir as autorizações e bases legais necessárias para fornecer à CONTRATADA os dados dos participantes. A CONTRATADA adotará medidas razoáveis para preservar a confidencialidade e a segurança dos dados recebidos.");

  cl("CLÁUSULA 10ª – DAS CONDIÇÕES CLIMÁTICAS E DO REAGENDAMENTO");
  p("10.1. O passeio será realizado normalmente em caso de chuva, desde que as condições de segurança permitam a execução do roteiro. Em caso de chuva intensa ou condições adversas que comprometam a segurança, a CONTRATADA poderá propor o reagendamento.");
  p("10.2. A CONTRATANTE poderá solicitar o reagendamento em razão de condições climáticas até as **12h00 do dia anterior** à realização do passeio. O reagendamento dependerá da disponibilidade da CONTRATADA e não será considerado cancelamento, permanecendo válidos os valores e demais condições deste contrato.");

  cl("CLÁUSULA 11ª – DAS ALTERAÇÕES DO ROTEIRO");
  p("11.1. O roteiro poderá ser alterado ou adaptado em razão de trânsito, interdições, obras, determinações de autoridades, condições climáticas, segurança, funcionamento ou restrições dos locais visitados ou outros fatores alheios à vontade da CONTRATADA, que poderá alterar a ordem das atividades, horários e pontos de parada, comunicando, sempre que possível, as alterações relevantes. A impossibilidade de realizar determinada etapa por motivo alheio à vontade da CONTRATADA não caracterizará, por si só, descumprimento contratual.");

  cl("CLÁUSULA 12ª – DA SEGURANÇA E DO ACOMPANHAMENTO");
  p("12.1. A CONTRATADA será responsável pela condução e operação do veículo e pela execução dos serviços contratados. A CONTRATANTE será responsável pelo acompanhamento, supervisão e controle dos participantes durante todo o passeio, inclusive nos embarques, desembarques, deslocamentos a pé, paradas e visitas.");
  p("12.2. Todos os participantes deverão respeitar as orientações de segurança do motorista, do guia de turismo e dos responsáveis da CONTRATANTE, bem como as regras dos locais visitados. A CONTRATADA não será responsável por pertences pessoais perdidos ou esquecidos, salvo responsabilidade direta comprovada.");

  cl("CLÁUSULA 13ª – DO CANCELAMENTO E DA DESISTÊNCIA");
  p("13.1. Eventual desistência ou cancelamento por iniciativa da CONTRATANTE após a assinatura não afastará as obrigações financeiras decorrentes da reserva contratada.");
  p(`13.2. Caso a CONTRATANTE cancele antes da realização do passeio, será devido à CONTRATADA o valor correspondente à primeira parcela${sinal != null ? `, de ${comExtenso(sinal)}` : ""}, e o valor já pago **não será devolvido**. A critério da CONTRATADA, poderá ser oferecida a remarcação do passeio ou crédito para sua realização em até **12 (doze) meses**.`);
  p("13.3. Nenhuma quantia será cobrada em duplicidade pelo mesmo fato gerador. O reagendamento realizado nos termos da Cláusula 10ª não será considerado cancelamento.");

  cl("CLÁUSULA 14ª – DA VIGÊNCIA E DAS COMUNICAÇÕES");
  p("14.1. O presente contrato entra em vigor na data de sua assinatura e permanecerá vigente até a conclusão dos serviços e o cumprimento integral das obrigações assumidas pelas partes.");
  p("14.2. As comunicações relacionadas a este contrato poderão ser realizadas por e-mail, WhatsApp ou outro meio que permita comprovar o envio e o recebimento. Alterações de roteiro, participantes, horários, pagamentos ou demais condições relevantes deverão, sempre que possível, ser formalizadas por escrito.");

  cl("CLÁUSULA 15ª – DA ASSINATURA E DA FORÇA DO CONTRATO");
  p("15.1. O presente instrumento obriga as partes e seus sucessores ao seu fiel cumprimento. As partes comprometem-se a fornecer informações verdadeiras e completas quanto aos seus dados cadastrais e representação legal.");
  p("15.2. As partes reconhecem a validade das assinaturas eletrônicas utilizadas na celebração deste instrumento, quando realizadas por meio que permita identificar os signatários e preservar a integridade do documento, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001 e da Lei nº 14.063/2020.");

  cl("CLÁUSULA 16ª – DO FORO");
  p(`16.1. Fica eleito o Foro da Comarca de **${e.cidadeForo}**, ressalvadas as hipóteses em que a legislação aplicável determine foro diverso, para dirimir quaisquer dúvidas ou controvérsias oriundas deste contrato.`);
  p("E, por estarem de acordo com todas as condições estabelecidas neste instrumento, as partes assinam o presente contrato.");
  p(`**${e.cidadeForo}, ${dataPorExtenso(emitidoEm)}.**`);

  b.push({
    tipo: "assinaturas",
    partes: [
      { papel: "CONTRATADA", nome: e.razaoSocial.toUpperCase(), linhas: [`Representante: ${e.assinanteNome ?? AFAZER}${e.assinanteCargo ? ` (${e.assinanteCargo})` : ""}`, "Assinatura:"] },
      { papel: "CONTRATANTE", nome: contratante.toUpperCase(), linhas: [`Representante: ${g.representanteNome ?? AFAZER}${g.representanteCargo ? ` (${g.representanteCargo})` : ""}`, "Assinatura:"] },
    ],
  });
  return b;
}

/** Recibo de pagamento de grupo (dono, 13/11/2026). */
export function montarReciboGrupo(p: { empresa: DadosEmpresaContrato; pagador: string; cnpjPagador: string | null; valorCentavos: number; referente: string; pagoEm: string }): BlocoContrato[] {
  return [
    { tipo: "titulo", texto: `RECIBO — ${reais(p.valorCentavos)}` },
    { tipo: "paragrafo", texto: `Recebemos de **${p.pagador}**${p.cnpjPagador ? `, CNPJ nº ${p.cnpjPagador}` : ""}, a quantia de ${comExtenso(p.valorCentavos)}, referente a ${p.referente}.` },
    { tipo: "paragrafo", texto: `Para clareza, firmamos o presente recibo, dando plena quitação do valor acima.` },
    { tipo: "paragrafo", texto: `**${p.empresa.cidadeForo}, ${dataPorExtenso(p.pagoEm)}.**` },
    { tipo: "assinaturas", partes: [{ papel: "", nome: `${p.empresa.razaoSocial.toUpperCase()} — CNPJ ${p.empresa.cnpj}`, linhas: [`${p.empresa.assinanteNome ?? ""}${p.empresa.assinanteCargo ? ` (${p.empresa.assinanteCargo})` : ""}`] }] },
  ];
}
