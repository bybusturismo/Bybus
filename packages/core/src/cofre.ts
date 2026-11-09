/**
 * Cofre de senhas (pedido do dono, 09/11/2026: "copie o formato do Cofre de senhas da TOMA"). Leitura das linhas coladas da
 * planilha de senhas (colunas A: categoria, B: nome, C…: dados de acesso), igual ao APP TOMA. Roda no navegador: as senhas vão
 * de quem importa direto para o servidor, sem passar por mais ninguém.
 */

/** Linhas coladas de uma planilha (Google Sheets/Excel): colunas separadas por tab; célula com quebra de linha vem entre aspas. */
export function lerColado(texto: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let cel = "";
  let aspas = false;
  const t = texto.replace(/\r\n?/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { cel += '"'; i++; } else if (c === '"') aspas = false; else cel += c;
    } else if (c === '"' && cel === "") aspas = true;
    else if (c === "\t") { linha.push(cel); cel = ""; } else if (c === "\n") { linha.push(cel); linhas.push(linha); linha = []; cel = ""; } else cel += c;
  }
  if (cel !== "" || linha.length) { linha.push(cel); linhas.push(linha); }
  return linhas;
}

const ROT_SENHA = "(?:senha|password|pass|pwd)";
const ROT_USUARIO = "(?:usu[aá]rio|usuario|login|e-?mail|user|cpf)";

/** Procura "Senha: …", "Usuário/Login/E-mail: …" e um endereço no texto da célula (tolerante a "Senha do app: x", "senha - x"…). */
export function separarAcesso(texto: string): { senha: string; usuario: string; url: string } {
  const linhas = texto.replace(/[\u00a0\u2028\u2029]/g, (c) => (c === "\u00a0" ? " " : "\n")).split("\n").map((l) => l.trim()).filter(Boolean);
  const achar = (...res: RegExp[]) => { for (const re of res) for (const l of linhas) { const m = l.match(re); if (m && m[1]!.trim()) return m[1]!.trim(); } return ""; };
  const campo = (rot: string) => [
    new RegExp(`^${rot}\\s*[:=]\\s*(.+)$`, "i"),
    new RegExp(`^${rot}\\b[^:=\\n]{0,30}[:=]\\s*(.+)$`, "i"),
    new RegExp(`^${rot}\\s*[-–—]\\s*(\\S.*)$`, "i"),
    new RegExp(`\\b${rot}\\b[^:=\\n]{0,20}[:=]\\s*(\\S+)`, "i"),
    new RegExp(`^${rot}\\s+(\\S+)$`, "i"),
  ];
  const senha = achar(...campo(ROT_SENHA));
  const usuario = achar(...campo(ROT_USUARIO)).replace(new RegExp(`\\s+${ROT_SENHA}\\b.*$`, "i"), "");
  const url = (texto.match(/https?:\/\/[^\s]+/i) ?? texto.match(/\bwww\.[^\s]+/i) ?? [""])[0]!;
  return { senha, usuario, url };
}

export interface ItemImportadoCofre { categoria: string; titulo: string; notas: string; senha: string; usuario: string; url: string }

/** Monta os itens a partir das linhas (célula mesclada: a categoria vale para as de baixo; linha de continuação junta no item de cima). */
export function montarImportacaoCofre(linhas: string[][], opcoes: { cabecalho: boolean }): ItemImportadoCofre[] {
  const itens: Array<{ categoria: string; titulo: string; notas: string }> = [];
  let categoria = "";
  for (const [a = "", b = "", ...resto] of linhas.slice(opcoes.cabecalho ? 1 : 0)) {
    const so = !b.trim() && !resto.some((x) => x.trim());
    if (so && a.trim() && itens.length && /[:=@]|https?:|www\.|^\s*(senha|password|usu[aá]rio|usuario|login|e-?mail|banco|ag[eê]ncia|conta|pix|opera[cç][aã]o|cpf|cnpj|c[oó]digo|token)\b/i.test(a)) {
      const ant = itens[itens.length - 1]!;
      ant.notas = `${ant.notas}\n${a.trim()}`.trim();
      continue;
    }
    if (a.trim()) categoria = a.trim().replace(/\s+/g, " ");
    const dados = resto.map((x) => x.trim()).filter(Boolean).join("\n");
    const nome = b.trim().replace(/\s+/g, " ");
    if (!nome) {
      const ant = itens[itens.length - 1];
      if (ant && dados) ant.notas = `${ant.notas}\n${dados}`.trim();
      continue;
    }
    itens.push({ categoria, titulo: nome, notas: dados });
  }
  return itens.map((x) => ({ ...x, ...separarAcesso(x.notas) }));
}

/** Senha forte gerada no navegador (sem caracteres parecidos). */
export function gerarSenhaForte(n = 20, aleatorio: (n: number) => Uint32Array = (k) => crypto.getRandomValues(new Uint32Array(k))): string {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?-_";
  return Array.from(aleatorio(n), (x) => letras[x % letras.length]).join("");
}
