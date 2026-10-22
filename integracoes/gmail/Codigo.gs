/**
 * Robô do Gmail do Bybus Gestão (Google Apps Script).
 *
 * Roda dentro da conta Gmail que recebe as confirmações (contatofbyb@gmail.com e admbybus@gmail.com),
 * a cada 5 minutos: procura e-mails de reserva da Bókun (Tripadvisor/Viator) e da Decolar, envia
 * para o sistema e marca no Gmail o que já foi processado. Nenhuma senha do Gmail sai da conta.
 *
 * Instalação: ver README.md nesta pasta.
 */

const ROTULO_ENVIADO = "bybus/enviado";
const BUSCA = "(from:bokun.io OR from:decolar.com OR from:despegar.com) newer_than:30d -label:" + ROTULO_ENVIADO.replace("/", "-");
const LOTE = 20;

function config_() {
  const p = PropertiesService.getScriptProperties();
  const url = p.getProperty("BYBUS_URL");
  const token = p.getProperty("BYBUS_TOKEN");
  if (!url || !token) throw new Error("Configure BYBUS_URL e BYBUS_TOKEN em Configurações do projeto > Propriedades do script.");
  return { url: url.replace(/\/$/, "") + "/api/integracoes/emails", token: token };
}

/** Executado pelo acionador a cada 5 minutos. */
function enviarReservas() {
  const cfg = config_();
  const rotulo = GmailApp.getUserLabelByName(ROTULO_ENVIADO) || GmailApp.createLabel(ROTULO_ENVIADO);
  const conversas = GmailApp.search(BUSCA, 0, 100);
  for (let i = 0; i < conversas.length; i += LOTE) {
    const lote = conversas.slice(i, i + LOTE);
    const mensagens = [];
    const conversaDe = {};
    lote.forEach(function (c) {
      c.getMessages().forEach(function (m) {
        mensagens.push({ id: m.getId(), remetente: m.getFrom(), assunto: m.getSubject(), corpo: m.getPlainBody().slice(0, 200000) });
        conversaDe[m.getId()] = c;
      });
    });
    if (mensagens.length === 0) continue;

    const resultados = [];
    for (let j = 0; j < mensagens.length; j += 50) {
      const resposta = UrlFetchApp.fetch(cfg.url, {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + cfg.token, "X-Bybus": "1" },
        payload: JSON.stringify({ mensagens: mensagens.slice(j, j + 50) }),
        muteHttpExceptions: true,
      });
      if (resposta.getResponseCode() !== 200) {
        console.error("Bybus respondeu " + resposta.getResponseCode() + ": " + resposta.getContentText().slice(0, 300));
        return; // nada deste lote é marcado; tenta de novo na próxima execução
      }
      Array.prototype.push.apply(resultados, JSON.parse(resposta.getContentText()).mensagens);
    }
    const pendentes = {};
    resultados.forEach(function (r) {
      // "SEM_LEITOR" (ex.: Decolar enquanto o leitor não existe) fica sem rótulo para ser reenviado depois.
      if (r.resultado === "SEM_LEITOR") pendentes[conversaDe[r.id].getId()] = true;
    });
    lote.forEach(function (c) {
      if (!pendentes[c.getId()]) c.addLabel(rotulo);
    });
  }
}

/** Rode uma vez para criar o acionador de 5 em 5 minutos. */
function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "enviarReservas") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("enviarReservas").timeBased().everyMinutes(5).create();
  enviarReservas();
}
