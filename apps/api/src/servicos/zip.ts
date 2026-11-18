import { deflateRawSync } from "node:zlib";

/**
 * ZIP mínimo (sem pacote novo) para baixar vários documentos de uma vez (dono, 18/11/2026: boletos, guias e comprovantes do mês
 * para a contabilidade). Formato PKZIP 2.0: cada arquivo comprimido (deflate) ou guardado como está quando não compensa
 * (PDF e foto já vêm comprimidos), nomes em UTF-8. Sem ZIP64: o chamador limita o total bem abaixo de 4 GB.
 */
const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(dados: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = TABELA[(c ^ dados[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Data e hora no formato do DOS (o que o ZIP guarda), no horário de São Paulo. */
function dataDos(d: Date): { hora: number; data: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(d).map((x) => [x.type, Number(x.value)]));
  return { hora: (p.hour! << 11) | (p.minute! << 5) | Math.floor(p.second! / 2), data: ((Math.max(1980, p.year!) - 1980) << 9) | (p.month! << 5) | p.day! };
}

export interface ArquivoZip { nome: string; dados: Buffer; data?: Date }

export function montarZip(arquivos: ArquivoZip[]): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let posicao = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, "utf8");
    const comprimido = deflateRawSync(a.dados);
    const usaDeflate = comprimido.length < a.dados.length;
    const corpo = usaDeflate ? comprimido : a.dados;
    const crc = crc32(a.dados);
    const { hora, data } = dataDos(a.data ?? new Date());
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0x0800, 6); // nome em UTF-8
    local.writeUInt16LE(usaDeflate ? 8 : 0, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(data, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(corpo.length, 18);
    local.writeUInt32LE(a.dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nome, corpo);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4); // feito por
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(usaDeflate ? 8 : 0, 10);
    c.writeUInt16LE(hora, 12);
    c.writeUInt16LE(data, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(corpo.length, 20);
    c.writeUInt32LE(a.dados.length, 24);
    c.writeUInt16LE(nome.length, 28);
    c.writeUInt32LE(posicao, 42);
    central.push(c, nome);
    posicao += local.length + nome.length + corpo.length;
  }
  const centralBuf = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(centralBuf.length, 12);
  fim.writeUInt32LE(posicao, 16);
  return Buffer.concat([...partes, centralBuf, fim]);
}

/** Nome seguro dentro do ZIP (sem barras nem caracteres que o Windows recusa), com no máximo `max` caracteres. */
export function nomeNoZip(texto: string, max = 90): string {
  return texto.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, max) || "arquivo";
}
