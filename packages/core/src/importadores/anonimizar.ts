import { DOCUMENTOS_FICTICIOS_OTA, somenteDigitos } from "../documento.js";
import type { ReservaImportada } from "./comum.js";

/**
 * Anonimização (LGPD) de reservas importadas para os ambientes de desenvolvimento e testes:
 * mantém tudo o que importa para testar a operação (canal, código, data, produto, ponto de embarque,
 * quantidade e categoria dos passageiros) e troca os dados pessoais por fictícios.
 * Determinística: a mesma reserva gera sempre os mesmos dados fictícios, então reimportar não duplica nem muda nomes.
 */

const NOMES = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio", "Gabriela", "Heitor", "Isabela", "João", "Karina", "Lucas", "Marina", "Nicolas", "Olívia", "Paulo", "Rafaela", "Sérgio", "Tatiana", "Vitor"];
const SOBRENOMES = ["Almeida", "Barros", "Cardoso", "Duarte", "Esteves", "Farias", "Gomes", "Hoffmann", "Ivo", "Jardim", "Lacerda", "Moura", "Nunes", "Oliveira", "Pereira", "Queiroz", "Ramos", "Silveira", "Teixeira", "Vidal"];

/** Hash FNV-1a de 32 bits (só para gerar valores estáveis; não é criptográfico). */
function hash(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function nomeFicticio(semente: string): string {
  const h = hash(semente);
  return `${NOMES[h % NOMES.length]} ${SOBRENOMES[(h >>> 8) % SOBRENOMES.length]} (fictício)`;
}

/** CPF válido gerado a partir da semente, sempre começando por 000 (faixa sem uso real conhecido). */
export function cpfFicticio(semente: string): string {
  const base = ("000" + String(hash(semente) % 1_000_000).padStart(6, "0")).split("").map(Number);
  const dv = (nums: number[]) => {
    const soma = nums.reduce((t, n, i) => t + n * (nums.length + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join("");
}

export function anonimizarReserva(r: ReservaImportada): ReservaImportada {
  const chave = `${r.canal}:${r.codigoExterno}`;
  return {
    ...r,
    contatoNome: nomeFicticio(`${chave}:contato`),
    contatoTelefone: r.contatoTelefone ? `+55 48 90000-${String(hash(chave) % 10_000).padStart(4, "0")}` : null,
    contatoEmail: r.contatoEmail ? `cliente.${hash(chave).toString(36)}@exemplo.invalid` : null,
    observacoes: r.observacoes ? "(observação omitida na anonimização)" : null,
    passageiros: r.passageiros.map((p, i) => {
      const semente = `${chave}:${i}`;
      const digitos = p.documento ? somenteDigitos(p.documento) : "";
      // Documentos fictícios das OTAs (1111/2222/3333) não são dados pessoais e indicam o canal: ficam.
      const documento = !p.documento ? null : digitos in DOCUMENTOS_FICTICIOS_OTA ? p.documento : p.documentoTipo === "CPF" ? cpfFicticio(semente) : `FIC${hash(semente) % 1_000_000}`;
      return { ...p, nome: nomeFicticio(semente), documento };
    }),
  };
}
