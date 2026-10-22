import { expect, test, type Page } from "@playwright/test";

/**
 * Fluxos críticos contra a API local com DADOS FICTÍCIOS (usuários *@bybus.test).
 * Screenshots opcionais: defina BYBUS_SCREENSHOTS=/caminho/da/pasta.
 * Atenção: a API limita o login a 10 tentativas/minuto por IP; a suíte faz 10. Espere 1 minuto entre execuções.
 */
const SENHA = "Bybus-teste-2026";
const PASTA = process.env.BYBUS_SCREENSHOTS;

async function foto(page: Page, nome: string, opcoes: { fullPage?: boolean } = {}) {
  if (PASTA) await page.screenshot({ path: `${PASTA}/${nome}.png`, fullPage: opcoes.fullPage ?? true });
}

async function entrar(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("button", { name: "Sair" })).toBeVisible();
}

async function abrirPrimeiraSaida(page: Page) {
  await page.getByRole("link", { name: "Saídas" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Saídas" })).toBeVisible();
  await page.getByRole("link", { name: /Abrir lista de passageiros de/ }).first().click();
  await expect(page.getByRole("toolbar", { name: "Ações da lista" })).toBeVisible();
}

test("login com senha errada mostra erro claro", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("E-mail").fill("atendente@bybus.test");
  await page.getByLabel("Senha").fill("senha-errada-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toContainText("E-mail ou senha incorretos");
  await foto(page, "01-login-erro");
});

test("supervisor: saídas → lista de passageiros → impressão → reserva → embarque", async ({ page }) => {
  await entrar(page, "supervisor@bybus.test");
  await expect(page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Usuários" })).toHaveCount(0);
  await page.getByRole("link", { name: "Saídas" }).click();
  await expect(page.getByText(/Pagantes \(mín\. 12\)/).first()).toBeVisible();
  await foto(page, "02-saidas");

  await abrirPrimeiraSaida(page);
  await expect(page.getByRole("heading", { name: /A DEFINIR/ })).toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();
  await foto(page, "03-lista-passageiros");

  // Documentos completos (permissão do supervisor) com aviso de auditoria.
  await page.getByLabel("Mostrar documentos completos").check();
  await expect(page.getByText("Este acesso fica registrado na auditoria")).toBeVisible();
  await page.getByLabel("Mostrar documentos completos").uncheck();

  // CSV exportável.
  const href = await page.getByRole("link", { name: "Exportar CSV" }).getAttribute("href");
  expect(href).toMatch(/manifesto\.csv\?documentos=mascarados$/);
  const csv = await page.request.get(href!);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("Ponto de embarque");

  // Impressão: cabeçalho e campo de assinatura aparecem; menu some.
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText("Assinatura da guia:")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Menu principal" })).toBeHidden();
  await foto(page, "04-impressao");
  if (PASTA) await page.pdf({ path: `${PASTA}/04-impressao-a4.pdf`, format: "A4", printBackground: true });
  await page.emulateMedia({ media: "screen" });

  // Incluir reserva com CPF inválido → erro no cliente; corrige → salva.
  await page.getByRole("link", { name: "Reservas" }).click();
  await page.getByRole("button", { name: "Incluir reserva" }).click();
  const dialogo = page.getByRole("dialog", { name: "Incluir reserva" });
  const titular = `Cliente E2E Ficticio ${Date.now() % 100000}`;
  await dialogo.getByLabel("Titular da reserva").fill(titular);
  await dialogo.getByLabel("Ponto de embarque").selectOption({ label: "08:00 — Villa Romana Shopping" });
  await dialogo.getByRole("button", { name: "Usar nome do titular" }).click();
  await dialogo.getByLabel("Tipo de documento").selectOption("CPF");
  await dialogo.getByLabel("Número do documento").fill("11122233300");
  await expect(dialogo.getByLabel("Número do documento")).toHaveValue("111.222.333-00");
  await dialogo.getByRole("button", { name: "Adicionar passageiro" }).click();
  await dialogo.getByRole("group", { name: "Passageiro 2" }).getByLabel("Categoria").selectOption("INFANTIL");
  await dialogo.getByRole("button", { name: "Salvar reserva" }).click();
  await expect(dialogo.getByText("CPF inválido")).toBeVisible();
  await foto(page, "05-reserva-cpf-invalido", { fullPage: false });
  await dialogo.getByLabel("Número do documento").first().fill("52998224725"); // CPF de exemplo público (fictício)
  await dialogo.getByRole("button", { name: "Salvar reserva" }).click();
  await expect(dialogo).toBeHidden();
  await expect(page.getByRole("heading", { name: titular })).toBeVisible();

  // Modo embarque: marca e desfaz.
  await page.getByRole("link", { name: "Modo embarque" }).click();
  await page.getByRole("tab", { name: /Villa Romana/ }).click();
  const botao = page.getByRole("button", { name: `Embarcou: ${titular}` });
  await botao.click();
  await expect(page.getByRole("button", { name: `Desfazer registro de ${titular}` })).toBeVisible();
  await foto(page, "06-embarque-desktop");
  await page.getByRole("button", { name: `Desfazer registro de ${titular}` }).click();
  await expect(page.getByRole("button", { name: `Embarcou: ${titular}` })).toBeVisible();

  // Limpeza: cancela a reserva de teste.
  await page.getByRole("link", { name: "Reservas" }).click();
  await page.getByRole("button", { name: `Cancelar reserva de ${titular}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar reserva" }).click();
  await expect(page.getByRole("heading", { name: titular })).toBeHidden();
});

test("guia no celular: modo embarque sem telefone e sem menus administrativos", async ({ browser }) => {
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await contexto.newPage();
  await entrar(page, "guia@bybus.test");
  const menu = page.getByRole("navigation", { name: "Menu principal" });
  await expect(menu.getByRole("link", { name: "Importar" })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "Auditoria" })).toHaveCount(0);
  await abrirPrimeiraSaida(page);
  await expect(page.getByRole("button", { name: "Confirmar saída" })).toHaveCount(0);
  await page.getByRole("link", { name: "Modo embarque" }).click();
  await expect(page.getByText(/de \d+ embarcados/)).toBeVisible();
  await expect(page.locator(".embarque")).not.toContainText("+55");
  const primeiro = page.getByRole("button", { name: /^Embarcou:/ }).first();
  const nome = (await primeiro.getAttribute("aria-label"))!.replace("Embarcou: ", "");
  await primeiro.tap();
  await expect(page.getByRole("button", { name: `Desfazer registro de ${nome}` })).toBeVisible();
  await foto(page, "07-embarque-celular", { fullPage: false });
  await page.getByRole("button", { name: `Desfazer registro de ${nome}` }).tap();
  await expect(page.getByRole("button", { name: `Embarcou: ${nome}` }).first()).toBeVisible();
  await contexto.close();
});

function emailBokun(codigo: string, dias: number) {
  const d = new Date(Date.now() + dias * 86_400_000);
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mes = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return [
    `New booking: ${codigo}`,
    `| Booking ref. | ${codigo} |`,
    "| Product | 165696P2 - Floripa City Tour by Bus - Whole Island |",
    "| Sold by | Viator.com |",
    "| Booking channel | Viator.com |",
    "| Customer | Exemplo, Pessoa |",
    "| Customer email | pessoa@exemplo.invalid |",
    `| Date | ${dia} ${d.getUTCDate()}.${mes} '${String(d.getUTCFullYear()).slice(2)} @ 08:00 |`,
    "| PAX | 2 Adult |",
    "| Pick-up | Hotel Ibis |",
  ].join("\n");
}

test("atendente: importar e-mail da Bókun com prévia e confirmação", async ({ page }) => {
  await entrar(page, "atendente@bybus.test");
  await page.getByRole("link", { name: "Importar" }).click();
  const codigo = `VIA-E2E${Date.now()}`;
  await page.getByLabel(/Texto dos e-mails/).fill(`${emailBokun(codigo, 5)}\n-----\nNewsletter qualquer\nOlá!`);
  await expect(page.getByText("2 e-mail(s) detectado(s).")).toBeVisible();
  await page.getByRole("button", { name: "Pré-visualizar" }).click();
  await expect(page.getByRole("cell", { name: codigo })).toBeVisible();
  await expect(page.getByText("Criar: 1")).toBeVisible();
  await expect(page.getByText(/1 bloco\(s\) colado\(s\) não foram reconhecidos/)).toBeVisible();
  await foto(page, "08-importar-previa");
  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Importar agora" }).click();
  await expect(page.getByText("Importação concluída", { exact: true })).toBeVisible();

  // Reimportar o mesmo e-mail não duplica: vira ATUALIZAR.
  await page.getByRole("button", { name: "Nova importação" }).click();
  await page.getByLabel(/Texto dos e-mails/).fill(emailBokun(codigo, 5));
  await page.getByRole("button", { name: "Pré-visualizar" }).click();
  await expect(page.getByText("Atualizar: 1")).toBeVisible();

  // Cancelamento pelo assunto.
  await page.getByLabel(/Texto dos e-mails/).fill(emailBokun(codigo, 5).replace("New booking", "Cancelled booking"));
  await page.getByRole("button", { name: "Pré-visualizar" }).click();
  await expect(page.getByText("Cancelar: 1")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Importar agora" }).click();
  await expect(page.getByText("Importação concluída", { exact: true })).toBeVisible();
});

test("admin + primeiro acesso: usuário novo → senha temporária → troca obrigatória → MFA → login com código → auditoria", async ({ page, browser }) => {
  const { authenticator } = await import("otplib");
  await entrar(page, "admin@bybus.test");
  await page.getByRole("link", { name: "Usuários" }).click();
  await page.getByRole("button", { name: "Novo usuário" }).click();
  const email = `novo.e2e.${Date.now()}@bybus.test`;
  const dialogo = page.getByRole("dialog", { name: "Novo usuário" });
  await dialogo.getByLabel("Nome").fill("Pessoa E2E Ficticia");
  await dialogo.getByLabel("E-mail").fill(email);
  await dialogo.getByLabel("Perfil").selectOption("ATENDENTE");
  await dialogo.getByRole("button", { name: "Criar usuário" }).click();
  const temporaria = (await page.locator(".senha-temporaria code").textContent())!;
  expect(temporaria.length).toBeGreaterThan(10);
  await foto(page, "11-senha-temporaria", { fullPage: false });
  await page.getByRole("button", { name: "Já anotei, fechar" }).click();

  const ctx = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const p = await ctx.newPage();
  await p.goto("/");
  await p.getByLabel("E-mail").fill(email);
  await p.getByLabel("Senha").fill(temporaria);
  await p.getByRole("button", { name: "Entrar" }).click();
  await expect(p.getByRole("heading", { name: "Troque sua senha" })).toBeVisible();
  const nova = "NovaSenhaE2E-2026";
  await p.getByLabel(/Senha atual/).fill(temporaria);
  await p.getByLabel("Nova senha", { exact: true }).fill(nova);
  await p.getByLabel("Confirme a nova senha").fill(nova);
  await p.getByRole("button", { name: "Trocar senha" }).click();
  await expect(p.getByRole("button", { name: "Sair" })).toBeVisible();

  // MFA voluntário em Minha conta, com código TOTP real.
  await p.getByRole("link", { name: "Minha conta" }).click();
  await p.getByRole("button", { name: "Configurar agora" }).click();
  await expect(p.getByRole("img", { name: /Código QR/ })).toBeVisible();
  await foto(p, "12-configurar-mfa", { fullPage: false });
  const segredo = (await p.locator(".mfa__segredo").textContent())!.replace(/\s/g, "");
  await p.getByLabel("Código de 6 dígitos").fill(authenticator.generate(segredo));
  await p.getByRole("button", { name: "Ativar verificação em duas etapas" }).click();
  await expect(p.getByText("Ativa. Para trocar de celular")).toBeVisible();
  await p.getByRole("button", { name: "Sair" }).click();

  await p.getByLabel("E-mail").fill(email);
  await p.getByLabel("Senha").fill(nova);
  await p.getByRole("button", { name: "Entrar" }).click();
  await expect(p.getByLabel(/Código de 6 dígitos do aplicativo/)).toBeVisible();
  await p.getByLabel(/Código de 6 dígitos do aplicativo/).fill("000000");
  await p.getByRole("button", { name: "Verificar e entrar" }).click();
  await expect(p.getByRole("alert")).toContainText("Código de verificação inválido");
  // O servidor recusa reutilizar o passo TOTP já usado; espera o próximo período de 30 s.
  await p.waitForTimeout(31_000 - (Date.now() % 30_000));
  await p.getByLabel(/Código de 6 dígitos do aplicativo/).fill(authenticator.generate(segredo));
  await p.getByRole("button", { name: "Verificar e entrar" }).click();
  await expect(p.getByRole("button", { name: "Sair" })).toBeVisible();
  await ctx.close();

  // Limpeza: desativa o usuário de teste.
  await page.reload();
  await page.getByRole("row", { name: new RegExp(email.replace(/\./g, "\\.")) }).getByRole("button", { name: "Desativar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Desativar" }).click();
  await expect(page.getByRole("row", { name: new RegExp(email.replace(/\./g, "\\.")) })).toContainText("Inativo");
  await foto(page, "09-usuarios");

  // Auditoria registra as ações.
  await page.getByRole("link", { name: "Auditoria" }).click();
  await expect(page.getByRole("columnheader", { name: "Data e hora" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Ativou verificação em duas etapas" }).first()).toBeVisible();
  await foto(page, "10-auditoria", { fullPage: false });
});

test("atendente: importar CSV da Paytour em ISO-8859-1", async ({ page }) => {
  await entrar(page, "atendente@bybus.test");
  await page.getByRole("link", { name: "Importar" }).click();
  await page.getByRole("tab", { name: "Paytour (CSV)" }).click();
  const d = new Date(Date.now() + 6 * 86_400_000);
  const data = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  const cod = `E2E${Date.now()}`;
  const csv = [
    "Código;Data;Atividade;Nome;Documento;Categoria;Ponto de embarque;Afiliado;Status;Observações",
    `${cod};${data};City Tour Toda Ilha;João Ficticio;529.982.247-25;Adulto;Villa Romana Shopping;;Confirmada;`,
    `${cod};${data};City Tour Toda Ilha;Conceição Ficticia;;Sênior;Villa Romana Shopping;;Confirmada;`,
    `;${data};City Tour Toda Ilha;Sem Codigo;;Adulto;;;Confirmada;`,
  ].join("\r\n");
  await page.getByLabel("Arquivo CSV exportado da Paytour").setInputFiles({ name: "paytour-ficticio.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "latin1") });
  await expect(page.getByText(/codificação ISO-8859-1/)).toBeVisible();
  await page.getByRole("button", { name: "Pré-visualizar" }).click();
  await expect(page.getByRole("cell", { name: `PAYTOUR-${cod}` })).toBeVisible();
  await expect(page.getByText(/linha\(s\) com problema/)).toBeVisible();
  await foto(page, "13-importar-paytour");
  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Importar agora" }).click();
  await expect(page.getByText("Importação concluída", { exact: true })).toBeVisible();
});
